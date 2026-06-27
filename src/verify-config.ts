import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { Bot } from "grammy";
import * as radarr from "./services/radarr";
import * as sonarr from "./services/sonarr";
import * as qbittorrent from "./services/qbittorrent";
import * as plex from "./services/plex";
import { getTimezone } from "./services/database";

export async function verifyConfig(exitOnFailure: boolean = true) {
    console.log("🔍 Starting configuration verification (Specs Audit)... \n");

    const checks = [
        {
            name: "Telegram Bot Token",
            fn: async () => {
                const token = process.env.TELEGRAM_BOT_TOKEN;
                if (!token) throw new Error("TELEGRAM_BOT_TOKEN is missing.");
                const bot = new Bot(token);
                const me = await bot.api.getMe();
                return `Success: Bot is @${me.username}`;
            }
        },
        {
            name: "Google Gemini AI API Key",
            fn: async () => {
                if (process.env.AI_PROVIDER === "ollama") {
                    return "Skipped: Using Ollama as provider.";
                }
                const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
                if (!key) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is missing.");
                const response = await generateText({
                    model: google("gemini-2.5-flash"),
                    prompt: "Hello, are you working?",
                    maxRetries: 1,
                });
                return `Success: Gemini responded.`;
            }
        },
        {
            name: "Ollama / Cloud Ollama Connectivity",
            fn: async () => {
                if (process.env.AI_PROVIDER !== "ollama") {
                    return "Skipped: Not using Ollama as provider.";
                }
                const modelName = process.env.OLLAMA_MODEL || process.env.AI_MODEL_FAST || "llama3.1";
                const baseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
                try {
                    const ollamaProvider = createOpenAI({ baseURL: `${baseUrl}/v1`, apiKey: "ollama" });
                    const response = await generateText({
                        model: ollamaProvider(modelName),
                        prompt: "Say hi",
                        maxRetries: 1,
                    });
                    return `Success: Ollama (${modelName}) at ${baseUrl} responded: ${response.text.slice(0, 80)}`;
                } catch (err: any) {
                    console.error("\nFull Ollama Error:", err);
                    throw err;
                }
            }
        },
        {
            name: "OpenAI/OpenRouter Connectivity",
            fn: async () => {
                if (process.env.AI_PROVIDER !== "openai") {
                    return "Skipped: Not using OpenAI as provider.";
                }
                const key = process.env.OPENAI_API_KEY;
                if (!key) throw new Error("OPENAI_API_KEY is missing.");

                const modelName = process.env.AI_MODEL_FAST || "gpt-4o-mini";
                const openaiProvider = createOpenAI({
                    apiKey: key,
                    baseURL: process.env.OPENAI_BASE_URL,
                });
                const response = await generateText({
                    model: openaiProvider(modelName),
                    prompt: "Hello, are you working?",
                    maxRetries: 1,
                });
                return `Success: OpenAI (${modelName}) responded.`;
            }
        },
        {
            name: "Radarr Connectivity",
            fn: async () => {
                const profiles = await radarr.getQualityProfiles();
                return `Success: Found ${profiles.length} quality profiles.`;
            }
        },
        {
            name: "Sonarr Connectivity",
            fn: async () => {
                const profiles = await sonarr.getQualityProfiles();
                return `Success: Found ${profiles.length} quality profiles.`;
            }
        },
        {
            name: "qBittorrent Connectivity",
            fn: async () => {
                await qbittorrent.getTorrents("all");
                return `Success: Successfully authenticated and listed torrents.`;
            }
        },
        {
            name: "NZBGet Connectivity",
            fn: async () => {
                const nzbget = await import("./services/nzbget");
                const version = await nzbget.getVersion();
                return `Success: Connected to NZBGet (Version: ${version}).`;
            }
        },
        {
            name: "Plex Connectivity",
            fn: async () => {
                const added = await plex.getRecentlyAdded();
                const movieSections = process.env.PLEX_MOVIE_SECTION_IDS;
                const showSections = process.env.PLEX_SHOW_SECTION_IDS;

                if (!movieSections || !showSections) {
                    throw new Error("Plex section IDs are missing (PLEX_MOVIE_SECTION_IDS or PLEX_SHOW_SECTION_IDS).");
                }

                return `Success: Connected to Plex library (Sections: Movies ${movieSections}, Shows ${showSections}).`;
            }
        },
        {
            name: "Allowed Users",
            fn: async () => {
                const allowed = process.env.ALLOWED_USER_IDS;
                if (!allowed) {
                    console.warn("⚠️  ALLOWED_USER_IDS is not set. Anyone will be able to talk to the bot!");
                    return "Warning: Open access enabled.";
                }
                return `Success: Whitelist configured with ${allowed.split(",").length} users.`;
            }
        },
        {
            name: "Proxy Configuration",
            fn: async () => {
                const proxyKey = process.env.PROXY_SECRET_KEY;
                if (!proxyKey) {
                    throw new Error("PROXY_SECRET_KEY is missing. The Proxy Gateway will refuse to start.");
                }
                const port = process.env.PROXY_PORT || 3001;
                return `Success: Proxy configured with secret key on port ${port}.`;
            }
        },
        {
            name: "Webhook Configuration",
            fn: async () => {
                const enabled = process.env.USE_PLEX_WEBHOOK === "true";
                if (!enabled) {
                    return "Skipped: Webhook server is disabled (USE_PLEX_WEBHOOK=false).";
                }
                const port = process.env.WEBHOOK_PORT || "3000";
                const notifyId = process.env.WEBHOOK_NOTIFY_CHAT_ID;
                if (!notifyId) {
                    return `Note: Webhooks enabled. Will notify the first ID from ALLOWED_USER_IDS (Port: ${port})`;
                }
                return `Success: Webhooks enabled. Will notify ${notifyId} (Port: ${port})`;
            }
        },
        {
            name: "Audit Log & Instance Check",
            fn: async () => {
                const logPath = "/tmp/agentic-media-bot-restart.log";
                const logFile = Bun.file(logPath);
                const logExists = await logFile.exists();

                // Check for multiple instances matching this script with more specific pattern
                let instances = 1;
                try {
                    const proc = Bun.spawnSync({
                        cmd: ["pgrep", "-f", "bun run src/bot.ts"],
                    });
                    const pids = proc.stdout.toString().split("\n").filter(Boolean);
                    instances = pids.length;

                    // Additional validation: check if PIDs are actually running our bot
                    const validPids = [];
                    for (const pid of pids) {
                        try {
                            const cmdProc = Bun.spawnSync({
                                cmd: ["ps", "-p", pid, "-o", "command="],
                            });
                            const cmd = cmdProc.stdout.toString().trim();
                            if (cmd.includes("bun run") && cmd.includes("src/bot.ts")) {
                                validPids.push(pid);
                            }
                        } catch (err) {
                            // PID might have died
                        }
                    }
                    instances = validPids.length;
                } catch (err) {
                    // Ignore pgrep failures
                }

                let msg = "";
                if (logExists) msg += "Log file found. ";
                else msg += "Log file missing (will be created on restart). ";

                if (instances > 1) {
                    throw new Error(`${msg}Detected ${instances} running instances. This will cause 409 Conflict errors.`);
                }

                return `Success: ${msg}Only 1 instance detected.`;
            }
        },
        {
            name: "System Timezone",
            fn: async () => {
                const tz = getTimezone();
                return `Success: Configured timezone is ${tz}.`;
            }
        }
    ];

    for (const check of checks) {
        process.stdout.write(`📡 Checking ${check.name.padEnd(30)}... `);
        try {
            const result = await check.fn();
            console.log("✅ " + result);
        } catch (error: any) {
            console.log("❌ Failed: " + (error.message || error));
            console.log("\n💡 Tip: Run 'bun src/setup.ts' to configure your environment interactively.\n");

            if (exitOnFailure) {
                process.exit(1); // Exit if critical config is missing
            } else {
                console.warn("⚠️ Continuing startup despite verification failure (non-fatal mode).");
            }
        }
    }

    console.log("\n✨ Verification complete.");
}

if (import.meta.main) {
    verifyConfig().catch(console.error);
}

