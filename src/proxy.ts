import { appendFileSync } from "node:fs";
import { serve } from "bun";
import * as aiTools from "./agent/tools";
import {
	areNotificationsEnabled,
	getAllConversations,
	getEventAlertConfig,
	getMetadata,
	getRawTimezone,
	getRecentMediaEvents,
	getTimezone,
	getUserName,
	saveMediaEvent,
	setEventAlertConfig,
	setMetadata,
	setNotificationsEnabled,
	setTimezone,
	setUserName,
} from "./services/database.ts";
import { checkAllServices } from "./services/health";
import { parseWebhookEvent } from "./services/webhookParser.ts";
import * as nzbget from "./services/nzbget";
import * as plex from "./services/plex";
import * as qbittorrent from "./services/qbittorrent";
import * as radarr from "./services/radarr";
import * as sonarr from "./services/sonarr";

const PROXY_PORT = Number(process.env.PROXY_PORT) || 3001;
const PROXY_SECRET_KEY = process.env.PROXY_SECRET_KEY;

if (!PROXY_SECRET_KEY) {
	console.error(
		"❌ PROXY_SECRET_KEY is not defined in the environment. The proxy API cannot start securely.",
	);
	process.exit(1);
}

// Map service names to their modules for dynamic dispatch
const services: Record<string, any> = {
	radarr,
	sonarr,
	plex,
	qbittorrent,
	nzbget,
	tools: aiTools,
};

const VERSION = "4.29.1";
console.log(
	`🚀 Starting Proxy Request Handler v${VERSION} on port ${PROXY_PORT}...`,
);
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
					"Access-Control-Allow-Headers": "Content-Type, Authorization",
				},
			});
		}

		// Health check endpoint — no auth required (used for uptime monitoring)
		if (req.method === "GET" && url.pathname === "/health") {
			return new Response(
				JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		// Dashboard API authentication
		// If DASHBOARD_TOKEN is configured, all /api/* requests (except the AI tool endpoint
		// which uses PROXY_SECRET_KEY) must carry: Authorization: Bearer <DASHBOARD_TOKEN>
		const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN?.trim();
		if (
			DASHBOARD_TOKEN &&
			url.pathname.startsWith("/api/") &&
			url.pathname !== "/api/tool"
		) {
			const authHeader = req.headers.get("Authorization");
			if (authHeader !== `Bearer ${DASHBOARD_TOKEN}`) {
				return new Response(JSON.stringify({ error: "Unauthorized" }), {
					status: 401,
					headers: {
						"Content-Type": "application/json",
						"Access-Control-Allow-Origin": "*",
					},
				});
			}
		}

		// Dashboard APIs
		if (req.method === "GET" && url.pathname === "/api/dashboard/status") {
			const status = await checkAllServices();
			return new Response(JSON.stringify({ status }), {
				status: 200,
				headers: {
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*",
				},
			});
		}

		if (req.method === "GET" && url.pathname === "/api/dashboard/logs") {
			try {
				const logFile = Bun.file("/tmp/agentic-media-bot-restart.log");
				if (await logFile.exists()) {
					const text = await logFile.text();
					const lines = text.split("\n").filter((l) => l.trim().length > 0);
					const recentLogs = lines.slice(-100);
					return new Response(JSON.stringify({ logs: recentLogs }), {
						status: 200,
						headers: {
							"Content-Type": "application/json",
							"Access-Control-Allow-Origin": "*",
						},
					});
				}
				return new Response(JSON.stringify({ logs: ["No logs available."] }), {
					status: 200,
					headers: {
						"Content-Type": "application/json",
						"Access-Control-Allow-Origin": "*",
					},
				});
			} catch (error) {
				return new Response(JSON.stringify({ logs: ["Error reading logs."] }), {
					status: 500,
					headers: {
						"Content-Type": "application/json",
						"Access-Control-Allow-Origin": "*",
					},
				});
			}
		}

		if (req.method === "GET" && url.pathname === "/api/dashboard/events") {
			try {
				const radarrEvents = getRecentMediaEvents("radarr", 10);
				const sonarrEvents = getRecentMediaEvents("sonarr", 10);
				const plexEvents = getRecentMediaEvents("plex", 10);

				const allEvents = [...radarrEvents, ...sonarrEvents, ...plexEvents]
					.sort(
						(a, b) =>
							new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
					)
					.slice(0, 15);

				return new Response(JSON.stringify({ events: allEvents }), {
					status: 200,
					headers: {
						"Content-Type": "application/json",
						"Access-Control-Allow-Origin": "*",
					},
				});
			} catch (error) {
				console.error("Failed to fetch events:", error);
				return new Response(
					JSON.stringify({ error: "Failed to fetch events" }),
					{
						status: 500,
						headers: {
							"Content-Type": "application/json",
							"Access-Control-Allow-Origin": "*",
						},
					},
				);
			}
		}

		if (
			req.method === "GET" &&
			url.pathname === "/api/settings/notifications"
		) {
			try {
				return new Response(
					JSON.stringify({
						radarr: {
							grab: getEventAlertConfig("radarr", "Grab"),
							download: getEventAlertConfig("radarr", "Download"),
						},
						sonarr: {
							grab: getEventAlertConfig("sonarr", "Grab"),
							download: getEventAlertConfig("sonarr", "Download"),
						},
						plex: {
							play: getEventAlertConfig("plex", "media.play"),
							resume: getEventAlertConfig("plex", "media.resume"),
							scrobble: getEventAlertConfig("plex", "media.scrobble"),
							library: getEventAlertConfig("plex", "library.new"),
						},
						timezone: getRawTimezone(),
					}),
					{
						status: 200,
						headers: {
							"Content-Type": "application/json",
							"Access-Control-Allow-Origin": "*",
						},
					},
				);
			} catch (error) {
				console.error("Failed to fetch notification settings:", error);
				return new Response(
					JSON.stringify({ error: "Failed to fetch settings" }),
					{
						status: 500,
						headers: {
							"Content-Type": "application/json",
							"Access-Control-Allow-Origin": "*",
						},
					},
				);
			}
		}

		// Webhook Relay (Needs streaming body, handled before JSON parsing)
		if (req.method === "POST" && url.pathname.endsWith("-webhook")) {
			let brainUrl = process.env.BRAIN_WEBHOOK_URL;
			if (!brainUrl) {
				console.warn(
					`Received webhook on ${url.pathname} but BRAIN_WEBHOOK_URL is not configured.`,
				);
			}

			// Parse from a clone so the original body stays readable for the relay.
			const parsed = await parseWebhookEvent(req.clone(), url.pathname);

			let timestamp = new Date().toISOString(); // Default fallback
			try {
				const tz = getTimezone();
				// Explicitly use 'en-GB' for a clean YYYY-MM-DD HH:MM:SS format
				timestamp = new Date()
					.toLocaleString("en-GB", { timeZone: tz, hour12: false })
					.replace(",", "");
			} catch {
				// Keep the ISO fallback if timezone resolution fails.
			}

			const logLine = parsed
				? `[${timestamp}] [WEBHOOK] Received ${parsed.service} event: ${parsed.event} (${parsed.title})\n`
				: `[${timestamp}] [WEBHOOK] [ERROR] Failed to process ${url.pathname}\n`;
			try {
				appendFileSync("/tmp/agentic-media-bot-restart.log", logLine);
			} catch (e) {
				console.error("Failed to write webhook log line:", e);
			}
			if (parsed) console.log(`📨 Relaying ${parsed.service} event: ${parsed.event}`);

			/**
			 * Fallback history write.
			 *
			 * On the happy path the bot is the *sole* writer of `media_events`: it
			 * receives the relayed webhook and records the event itself. The proxy
			 * must not also write, because both processes share the same SQLite file
			 * and `saveMediaEvent` dedups on (service, event_type, title) within 60s
			 * — a proxy-written row makes the bot's own `dbSave()` return false, and
			 * the event queue then skips the Telegram notification entirely. For
			 * NZBGet and qBittorrent the two writers derive identical tuples, so
			 * those notifications were being dropped every time.
			 *
			 * When the relay never reaches the bot, nobody else will record the
			 * event, so the proxy writes it here to preserve history.
			 */
			const saveFallbackEvent = () => {
				if (!parsed) return;
				try {
					saveMediaEvent(
						parsed.service,
						parsed.event,
						parsed.title,
						parsed.message,
					);
					console.log(
						`💾 Bot unreachable — stored ${parsed.service} event locally: ${parsed.event}`,
					);
				} catch (e) {
					console.error("Failed to store webhook event locally:", e);
				}
			};

			if (!brainUrl) {
				saveFallbackEvent();
				return new Response("OK", { status: 200 });
			}

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
					body: req.body || undefined,
				});

				return new Response(response.body, {
					status: response.status,
					headers: response.headers,
				});
			} catch (error) {
				console.error("Failed to forward webhook to brain (bot):", error);
				// The bot never saw this event, so record it here to preserve history,
				// then return 200 OK so Sonarr/Radarr/Plex don't think it failed
				// completely. A non-2xx *response* is not a failure — the bot answered
				// and owns the write; only a thrown fetch error lands here.
				saveFallbackEvent();
				return new Response(
					JSON.stringify({
						success: true,
						message:
							"Event logged locally, but relay to bot failed (bot may be offline).",
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				);
			}
		}

		// Other POST requests (Settings and Tools)
		if (req.method === "POST") {
			let body: any = null;
			try {
				body = await req.json();
			} catch (e) {
				console.error("Failed to parse JSON body:", e);
				return new Response(JSON.stringify({ error: "Invalid JSON" }), {
					status: 400,
				});
			}

			// Notification Settings
			if (url.pathname === "/api/settings/notifications") {
				try {
					console.log(
						"📥 Received Settings Update:",
						JSON.stringify(body, null, 2),
					);
					const { radarr, sonarr, plex, timezone } = body || {};
					if (radarr) {
						if (typeof radarr.grab === "boolean")
							setEventAlertConfig("radarr", "Grab", radarr.grab);
						if (typeof radarr.download === "boolean")
							setEventAlertConfig("radarr", "Download", radarr.download);
					}
					if (sonarr) {
						if (typeof sonarr.grab === "boolean")
							setEventAlertConfig("sonarr", "Grab", sonarr.grab);
						if (typeof sonarr.download === "boolean")
							setEventAlertConfig("sonarr", "Download", sonarr.download);
					}
					if (plex) {
						if (typeof plex.play === "boolean")
							setEventAlertConfig("plex", "media.play", plex.play);
						if (typeof plex.resume === "boolean")
							setEventAlertConfig("plex", "media.resume", plex.resume);
						if (typeof plex.scrobble === "boolean")
							setEventAlertConfig("plex", "media.scrobble", plex.scrobble);
						if (typeof plex.library === "boolean")
							setEventAlertConfig("plex", "library.new", plex.library);
					}
					if (timezone !== undefined) {
						console.log(`📡 Saving Timezone: ${timezone}`);
						setTimezone(timezone);
					}
					return new Response(JSON.stringify({ success: true }), {
						status: 200,
						headers: {
							"Content-Type": "application/json",
							"Access-Control-Allow-Origin": "*",
						},
					});
				} catch (error) {
					console.error("Error saving notification settings:", error);
					return new Response(JSON.stringify({ error: "Internal Error" }), {
						status: 500,
					});
				}
			}

			// AI Tool Calls
			if (url.pathname === "/api/tool") {
				const authHeader = req.headers.get("Authorization");
				if (authHeader !== `Bearer ${PROXY_SECRET_KEY}`) {
					return new Response(JSON.stringify({ error: "Unauthorized" }), {
						status: 401,
					});
				}

				try {
					const { service, method, args } = body || {};
					if (!service || !method) {
						return new Response(
							JSON.stringify({ error: "Missing 'service' or 'method'" }),
							{ status: 400 },
						);
					}

					const targetService = services[service];
					if (!targetService) {
						return new Response(
							JSON.stringify({ error: `Service '${service}' not found` }),
							{ status: 404 },
						);
					}

					let targetFunction = targetService[method];
					if (targetFunction?.execute) targetFunction = targetFunction.execute;

					if (typeof targetFunction !== "function") {
						return new Response(
							JSON.stringify({ error: `Method '${method}' not found` }),
							{ status: 404 },
						);
					}

					const result = await targetFunction(...(args || []));
					return new Response(JSON.stringify({ success: true, result }), {
						status: 200,
					});
				} catch (error: any) {
					console.error("Proxy execution error:", error);
					return new Response(JSON.stringify({ error: error.message }), {
						status: 500,
					});
				}
			}
		}

		// Static file serving
		if (req.method === "GET") {
			const relativePath =
				url.pathname === "/" ? "index.html" : url.pathname.slice(1);
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
	},
});

console.log(`✅ API Proxy Gateway running on http://localhost:${PROXY_PORT}`);
