import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { ollama } from "ollama-ai-provider";
import { Bot } from "grammy";
import * as radarr from "./services/radarr";
import * as sonarr from "./services/sonarr";
import * as qbittorrent from "./services/qbittorrent";
import * as plex from "./services/plex";

export async function verifyConfig() {
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
                    model: google("gemini-1.5-flash-latest"),
                    prompt: "Hello, are you working?",
                    maxRetries: 1,
                });
                return `Success: Gemini responded.`;
            }
        },
        {
            name: "Ollama Connectivity (Local Agent)",
            fn: async () => {
                const modelName = process.env.OLLAMA_MODEL || "llama3.1";
                const response = await generateText({
                    model: ollama(modelName) as any,
                    prompt: "Say 'Local agent active'",
                    maxRetries: 1,
                });
                return `Success: Ollama (${modelName}) responded: ${response.text}`;
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
            name: "Plex Connectivity",
            fn: async () => {
                const added = await plex.getRecentlyAdded();
                return `Success: Connected to Plex library.`;
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
        }
    ];

    for (const check of checks) {
        process.stdout.write(`📡 Checking ${check.name.padEnd(30)}... `);
        try {
            const result = await check.fn();
            console.log("✅ " + result);
        } catch (error: any) {
            console.log("❌ Failed: " + (error.message || error));
        }
    }

    console.log("\n✨ Verification complete.");
}

// verifyConfig().catch(console.error);
