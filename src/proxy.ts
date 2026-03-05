import { serve } from "bun";
import * as radarr from "./services/radarr";
import * as sonarr from "./services/sonarr";
import * as plex from "./services/plex";
import * as qbittorrent from "./services/qbittorrent";
import * as nzbget from "./services/nzbget";
import * as aiTools from "./agent/tools";

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

        // Health check endpoint
        if (req.method === "GET" && url.pathname === "/health") {
            return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Security check for API tool calls
        if (req.method === "POST" && url.pathname === "/api/tool") {
            const authHeader = req.headers.get("Authorization");
            if (authHeader !== `Bearer ${PROXY_SECRET_KEY}`) {
                return new Response(JSON.stringify({ error: "Unauthorized" }), {
                    status: 401,
                    headers: { "Content-Type": "application/json" }
                });
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
            const brainUrl = process.env.BRAIN_WEBHOOK_URL; // e.g., https://bot.domain.com

            if (!brainUrl) {
                console.warn(`Received webhook on ${url.pathname} but BRAIN_WEBHOOK_URL is not configured. Acknowledging anyway.`);
                return new Response("OK", { status: 200 });
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

        return new Response("Not Found", { status: 404 });
    }
});

console.log(`✅ API Proxy Gateway running on http://localhost:${PROXY_PORT}`);
