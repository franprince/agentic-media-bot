import { serve } from "bun";
import { appendFileSync } from "node:fs";
import * as radarr from "./services/radarr";
import * as sonarr from "./services/sonarr";
import * as plex from "./services/plex";
import * as qbittorrent from "./services/qbittorrent";
import * as nzbget from "./services/nzbget";
import * as aiTools from "./agent/tools";
import { checkAllServices } from "./services/health";
import { getMetadata, setMetadata, getAllConversations, getUserName, setUserName, areNotificationsEnabled, setNotificationsEnabled, getRecentMediaEvents, setEventAlertConfig, saveMediaEvent, getEventAlertConfig, getTimezone, setTimezone, getRawTimezone } from "./services/database.ts";

const PROXY_PORT = Number(process.env.PROXY_PORT) || 3001;
const PROXY_SECRET_KEY = process.env.PROXY_SECRET_KEY;

if (!PROXY_SECRET_KEY) {
    console.error("❌ PROXY_SECRET_KEY is not defined in the environment. The proxy API cannot start securely.");
    process.exit(1);
}

// Map service names to their modules for dynamic dispatch
const services: Record<string, any> = {
    radarr,
    sonarr,
    plex,
    qbittorrent,
    nzbget,
    tools: aiTools
};

const VERSION = "4.29.1";
console.log(`🚀 Starting Proxy Request Handler v${VERSION} on port ${PROXY_PORT}...`);
console.log(`🕒 System Timezone: ${getTimezone()} (Raw: ${getRawTimezone()})`);

serve({
    port: PROXY_PORT,
    async fetch(req) {
        const url = new URL(req.url);

        // CORS preflight requests
        if (req.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization"
                }
            });
        }

        // Health check endpoint — no auth required (used for uptime monitoring)
        if (req.method === "GET" && url.pathname === "/health") {
            return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Dashboard API authentication
        // If DASHBOARD_TOKEN is configured, all /api/* requests (except the AI tool endpoint
        // which uses PROXY_SECRET_KEY) must carry: Authorization: Bearer <DASHBOARD_TOKEN>
        const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN?.trim();
        if (DASHBOARD_TOKEN && url.pathname.startsWith("/api/") && url.pathname !== "/api/tool") {
            const authHeader = req.headers.get("Authorization");
            if (authHeader !== `Bearer ${DASHBOARD_TOKEN}`) {
                return new Response(JSON.stringify({ error: "Unauthorized" }), {
                    status: 401,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                });
            }
        }

        // Dashboard APIs
        if (req.method === "GET" && url.pathname === "/api/dashboard/status") {
            const status = await checkAllServices();
            return new Response(JSON.stringify({ status }), {
                status: 200,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        if (req.method === "GET" && url.pathname === "/api/dashboard/logs") {
            try {
                const logFile = Bun.file("/tmp/agentic-media-bot-restart.log");
                if (await logFile.exists()) {
                    const text = await logFile.text();
                    const lines = text.split("\n").filter(l => l.trim().length > 0);
                    const recentLogs = lines.slice(-100);
                    return new Response(JSON.stringify({ logs: recentLogs }), {
                        status: 200,
                        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                    });
                }
                return new Response(JSON.stringify({ logs: ["No logs available."] }), {
                    status: 200,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                });
            } catch (error) {
                return new Response(JSON.stringify({ logs: ["Error reading logs."] }), {
                    status: 500,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                });
            }
        }

        if (req.method === "GET" && url.pathname === "/api/dashboard/events") {
            try {
                const radarrEvents = getRecentMediaEvents("radarr", 10);
                const sonarrEvents = getRecentMediaEvents("sonarr", 10);
                const plexEvents = getRecentMediaEvents("plex", 10);

                const allEvents = [...radarrEvents, ...sonarrEvents, ...plexEvents]
                    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                    .slice(0, 15);

                return new Response(JSON.stringify({ events: allEvents }), {
                    status: 200,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                });
            } catch (error) {
                console.error("Failed to fetch events:", error);
                return new Response(JSON.stringify({ error: "Failed to fetch events" }), {
                    status: 500,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                });
            }
        }

        if (req.method === "GET" && url.pathname === "/api/settings/notifications") {
            try {
                return new Response(JSON.stringify({
                    radarr: { grab: getEventAlertConfig("radarr", "Grab"), download: getEventAlertConfig("radarr", "Download") },
                    sonarr: { grab: getEventAlertConfig("sonarr", "Grab"), download: getEventAlertConfig("sonarr", "Download") },
                    plex: {
                        play: getEventAlertConfig("plex", "media.play"),
                        resume: getEventAlertConfig("plex", "media.resume"),
                        scrobble: getEventAlertConfig("plex", "media.scrobble"),
                        library: getEventAlertConfig("plex", "library.new")
                    },
                    timezone: getRawTimezone()
                }), {
                    status: 200,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                });
            } catch (error) {
                console.error("Failed to fetch notification settings:", error);
                return new Response(JSON.stringify({ error: "Failed to fetch settings" }), {
                    status: 500,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                });
            }
        }

        // Webhook Relay (Needs streaming body, handled before JSON parsing)
        if (req.method === "POST" && url.pathname.endsWith("-webhook")) {
            let brainUrl = process.env.BRAIN_WEBHOOK_URL;
            if (!brainUrl) {
                console.warn(`Received webhook on ${url.pathname} but BRAIN_WEBHOOK_URL is not configured.`);
            }

            // Clone the request so we can read the body for logging AND relay it
            const clonedReq = req.clone();

            // Background logging
            (async () => {
                let timestamp = new Date().toISOString(); // Default fallback
                try {
                    const tz = getTimezone();
                    // Explicitly use 'en-GB' for a clean YYYY-MM-DD HH:MM:SS format
                    timestamp = new Date().toLocaleString("en-GB", { timeZone: tz, hour12: false }).replace(",", "");

                    let service = "";
                    let event = "";
                    let title = "";
                    let message = "";

                    if (url.pathname === "/plex-webhook") {
                        service = "plex";
                        const formData = await clonedReq.formData();
                        const payloadRaw = formData.get("payload");
                        if (!payloadRaw || typeof payloadRaw !== "string") {
                            throw new Error("Missing 'payload' in Plex webhook");
                        }
                        const payload = JSON.parse(payloadRaw);
                        event = payload.event || "unknown";

                        const m = payload.Metadata || {};
                        if (m.type === 'episode' && m.grandparentTitle) {
                            title = `${m.grandparentTitle} - ${m.title}`;
                        } else {
                            title = m.title || "Unknown Title";
                        }

                        message = `Plex Event: ${event} - ${title}`;
                    } else if (url.pathname === "/api/nzbget-webhook") {
                        service = "nzbget";
                        const payload = await clonedReq.json() as any;
                        event = payload.event || "added";
                        title = payload.title || "Unknown NZB";
                        const speed = payload.speed ? ` (${payload.speed} MB/s)` : "";
                        const eta = payload.eta ? ` [ETA: ${payload.eta}]` : "";
                        message = `NZBGet Event: ${event} - ${title}${speed}${eta}`;
                    } else {
                        service = url.pathname.includes("radarr") ? "radarr" : "sonarr";
                        const payload = await clonedReq.json() as any;
                        event = payload.eventType || "unknown";

                        if (service === "sonarr" && payload.series) {
                            const seriesName = payload.series.title;
                            let epDetails = "";
                            if (payload.episodes && payload.episodes.length > 0) {
                                const ep = payload.episodes[0];
                                epDetails = ` - S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')} - ${ep.title}`;
                            }
                            title = `${seriesName}${epDetails}`;
                        } else if (service === "radarr" && payload.movie) {
                            title = payload.movie.title;
                        } else {
                            title = payload.movie?.title || payload.series?.title || "Unknown Title";
                        }

                        message = `${service.charAt(0).toUpperCase() + service.slice(1)} Event: ${event} - ${title}`;
                    }

                    if (service && event) {
                        saveMediaEvent(service, event, title, message);
                        const logLine = `[${timestamp}] [WEBHOOK] Received ${service} event: ${event} (${title})\n`;
                        appendFileSync("/tmp/agentic-media-bot-restart.log", logLine);
                        console.log(`✅ Logged ${service} event: ${event}`);
                    }
                } catch (e) {
                    const errorLine = `[${timestamp}] [WEBHOOK] [ERROR] Failed to process ${url.pathname}: ${e}\n`;
                    appendFileSync("/tmp/agentic-media-bot-restart.log", errorLine);
                    console.error("Failed to log event in proxy:", e);
                }
            })();

            if (!brainUrl) return new Response("OK", { status: 200 });

            if (!brainUrl.startsWith("http")) {
                brainUrl = `http://${brainUrl}`;
                if (!brainUrl.match(/:\d+$/)) brainUrl = `${brainUrl}:3000`;
            }

            try {
                const forwardUrl = `${brainUrl.replace(/\/$/, "")}${url.pathname}`;
                const headers = new Headers(req.headers);
                headers.delete("host");

                const response = await fetch(forwardUrl, {
                    method: req.method,
                    headers: headers,
                    body: req.body || undefined
                });

                return new Response(response.body, { status: response.status, headers: response.headers });
            } catch (error) {
                console.error("Failed to forward webhook to brain (bot):", error);
                // Since we already logged the event to the database in the background block,
                // we can return 200 OK so Sonarr/Radarr/Plex don't think it failed completely.
                return new Response(JSON.stringify({
                    success: true,
                    message: "Event logged locally, but relay to bot failed (bot may be offline)."
                }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
        }

        // Other POST requests (Settings and Tools)
        if (req.method === "POST") {
            let body: any = null;
            try {
                body = await req.json();
            } catch (e) {
                console.error("Failed to parse JSON body:", e);
                return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
            }

            // Notification Settings
            if (url.pathname === "/api/settings/notifications") {
                try {
                    console.log("📥 Received Settings Update:", JSON.stringify(body, null, 2));
                    const { radarr, sonarr, plex, timezone } = body || {};
                    if (radarr) {
                        if (typeof radarr.grab === "boolean") setEventAlertConfig("radarr", "Grab", radarr.grab);
                        if (typeof radarr.download === "boolean") setEventAlertConfig("radarr", "Download", radarr.download);
                    }
                    if (sonarr) {
                        if (typeof sonarr.grab === "boolean") setEventAlertConfig("sonarr", "Grab", sonarr.grab);
                        if (typeof sonarr.download === "boolean") setEventAlertConfig("sonarr", "Download", sonarr.download);
                    }
                    if (plex) {
                        if (typeof plex.play === "boolean") setEventAlertConfig("plex", "media.play", plex.play);
                        if (typeof plex.resume === "boolean") setEventAlertConfig("plex", "media.resume", plex.resume);
                        if (typeof plex.scrobble === "boolean") setEventAlertConfig("plex", "media.scrobble", plex.scrobble);
                        if (typeof plex.library === "boolean") setEventAlertConfig("plex", "library.new", plex.library);
                    }
                    if (timezone !== undefined) {
                        console.log(`📡 Saving Timezone: ${timezone}`);
                        setTimezone(timezone);
                    }
                    return new Response(JSON.stringify({ success: true }), {
                        status: 200,
                        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                    });
                } catch (error) {
                    console.error("Error saving notification settings:", error);
                    return new Response(JSON.stringify({ error: "Internal Error" }), { status: 500 });
                }
            }

            // AI Tool Calls
            if (url.pathname === "/api/tool") {
                const authHeader = req.headers.get("Authorization");
                if (authHeader !== `Bearer ${PROXY_SECRET_KEY}`) {
                    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
                }

                try {
                    const { service, method, args } = body || {};
                    if (!service || !method) {
                        return new Response(JSON.stringify({ error: "Missing 'service' or 'method'" }), { status: 400 });
                    }

                    const targetService = services[service];
                    if (!targetService) {
                        return new Response(JSON.stringify({ error: `Service '${service}' not found` }), { status: 404 });
                    }

                    let targetFunction = targetService[method];
                    if (targetFunction?.execute) targetFunction = targetFunction.execute;

                    if (typeof targetFunction !== "function") {
                        return new Response(JSON.stringify({ error: `Method '${method}' not found` }), { status: 404 });
                    }

                    const result = await targetFunction(...(args || []));
                    return new Response(JSON.stringify({ success: true, result }), { status: 200 });
                } catch (error: any) {
                    console.error("Proxy execution error:", error);
                    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
                }
            }
        }

        // Static file serving
        if (req.method === "GET") {
            let relativePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
            let uiDistPath = `${import.meta.dir}/proxy-ui/dist`;
            if (!(await Bun.file(`${uiDistPath}/index.html`).exists())) {
                uiDistPath = `${import.meta.dir}/../proxy-ui/dist`;
            }
            const absolutePath = `${uiDistPath}/${relativePath}`;
            const file = Bun.file(absolutePath);

            if (await file.exists()) {
                return new Response(file);
            } else if (!url.pathname.startsWith("/api/")) {
                const indexFile = Bun.file(`${uiDistPath}/index.html`);
                if (await indexFile.exists()) return new Response(indexFile);
            }
        }

        return new Response("Not Found", { status: 404 });
    }
});

console.log(`✅ API Proxy Gateway running on http://localhost:${PROXY_PORT}`);
