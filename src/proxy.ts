import { serve } from "bun";
import * as radarr from "./services/radarr";
import * as sonarr from "./services/sonarr";
import * as plex from "./services/plex";
import * as qbittorrent from "./services/qbittorrent";
import * as nzbget from "./services/nzbget";
import * as aiTools from "./agent/tools";
import { checkAllServices } from "./services/health";
import { getRecentMediaEvents, getEventAlertConfig, setEventAlertConfig } from "./services/database";

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

console.log(`Starting Proxy Request Handler on port ${PROXY_PORT}...`);

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

        // Health check endpoint
        if (req.method === "GET" && url.pathname === "/health") {
            return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
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
                // Fetch events for Radarr, Sonarr, and Plex
                const radarrEvents = getRecentMediaEvents("radarr", 10);
                const sonarrEvents = getRecentMediaEvents("sonarr", 10);
                const plexEvents = getRecentMediaEvents("plex", 10);

                // Combine, sort by timestamp descending, and take the top 15
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
                // Fetch the current settings. We assume true if not set in DB
                const radarrGrab = getEventAlertConfig("radarr", "grab");
                const radarrDownload = getEventAlertConfig("radarr", "download");
                const sonarrGrab = getEventAlertConfig("sonarr", "grab");
                const sonarrDownload = getEventAlertConfig("sonarr", "download");

                return new Response(JSON.stringify({
                    radarr: { grab: radarrGrab, download: radarrDownload },
                    sonarr: { grab: sonarrGrab, download: sonarrDownload }
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

        // Security check for API tool calls and POST requests
        if (req.method === "POST" && (url.pathname === "/api/tool" || url.pathname === "/api/settings/notifications")) {
            const authHeader = req.headers.get("Authorization");
            if (authHeader !== `Bearer ${PROXY_SECRET_KEY}`) {
                return new Response(JSON.stringify({ error: "Unauthorized" }), {
                    status: 401,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                });
            }

            if (url.pathname === "/api/settings/notifications") {
                try {
                    const body = await req.json() as any;
                    const { radarr, sonarr } = body;

                    if (radarr) {
                        if (typeof radarr.grab === "boolean") setEventAlertConfig("radarr", "grab", radarr.grab);
                        if (typeof radarr.download === "boolean") setEventAlertConfig("radarr", "download", radarr.download);
                    }
                    if (sonarr) {
                        if (typeof sonarr.grab === "boolean") setEventAlertConfig("sonarr", "grab", sonarr.grab);
                        if (typeof sonarr.download === "boolean") setEventAlertConfig("sonarr", "download", sonarr.download);
                    }

                    return new Response(JSON.stringify({ success: true }), {
                        status: 200,
                        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                    });
                } catch (error) {
                    console.error("Error saving notification settings:", error);
                    return new Response(JSON.stringify({ error: "Internal Error" }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
                }
            }

            try {
                const body = await req.json() as any;
                const { service, method, args } = body;

                if (!service || !method) {
                    return new Response(JSON.stringify({ error: "Missing 'service' or 'method' in request payload." }), {
                        status: 400,
                        headers: { "Content-Type": "application/json" }
                    });
                }

                const targetService = services[service];
                if (!targetService) {
                    return new Response(JSON.stringify({ error: `Service '${service}' not found on Proxy.` }), {
                        status: 404,
                        headers: { "Content-Type": "application/json" }
                    });
                }

                let targetFunction = targetService[method];

                // If the target is an AI SDK Tool, extract its execute function
                if (targetFunction && typeof targetFunction === "object" && typeof targetFunction.execute === "function") {
                    targetFunction = targetFunction.execute;
                }

                if (typeof targetFunction !== "function") {
                    return new Response(JSON.stringify({ error: `Method '${method}' not found on service '${service}'.` }), {
                        status: 404,
                        headers: { "Content-Type": "application/json" }
                    });
                }

                // Execute the function
                const result = await targetFunction(...(args || []));

                return new Response(JSON.stringify({ success: true, result }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });

            } catch (error: any) {
                console.error("Proxy execution error:", error);
                return new Response(JSON.stringify({ error: error.message || "Internal Proxy Error" }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                });
            }
        }

        // Webhook Relay
        if (req.method === "POST" && url.pathname.endsWith("-webhook")) {
            let brainUrl = process.env.BRAIN_WEBHOOK_URL; // e.g., https://bot.domain.com

            if (!brainUrl) {
                console.warn(`Received webhook on ${url.pathname} but BRAIN_WEBHOOK_URL is not configured. Acknowledging anyway.`);
                return new Response("OK", { status: 200 });
            }

            if (!brainUrl.startsWith("http")) {
                brainUrl = `http://${brainUrl}`;
                if (!brainUrl.match(/:\d+$/)) brainUrl = `${brainUrl}:3000`;
            }

            try {
                // Forward the request exactly as received (headers, multipart form data, etc.)
                const forwardUrl = `${brainUrl.replace(/\/$/, "")}${url.pathname}`;
                console.log(`Forwarding webhook to ${forwardUrl}`);

                const headers = new Headers(req.headers);
                // Remove host to avoid conflicts during forwarding
                headers.delete("host");

                const response = await fetch(forwardUrl, {
                    method: req.method,
                    headers: headers,
                    body: req.body || undefined
                });

                return new Response(response.body, { status: response.status, headers: response.headers });
            } catch (error) {
                console.error("Failed to forward webhook:", error);
                return new Response("Webhook relay failed", { status: 500 });
            }
        }

        // Static file serving for proxy-ui
        if (req.method === "GET") {
            let relativePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
            const absolutePath = `${import.meta.dir}/../proxy-ui/dist/${relativePath}`;
            const file = Bun.file(absolutePath);

            if (await file.exists()) {
                return new Response(file);
            } else if (!url.pathname.startsWith("/api/")) {
                const indexFile = Bun.file(`${import.meta.dir}/../proxy-ui/dist/index.html`);
                if (await indexFile.exists()) {
                    return new Response(indexFile);
                }
            }
        }

        return new Response("Not Found", { status: 404 });
    }
});

console.log(`✅ API Proxy Gateway running on http://localhost:${PROXY_PORT}`);
