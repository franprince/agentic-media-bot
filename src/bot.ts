import { Bot } from "grammy";
import { run } from "@grammyjs/runner";
import { processUserMessage } from "./agent/index.ts";
import { detectStatusLanguage } from "./agent/status.ts";
import { getMetadata, setMetadata, getAllConversations } from "./services/database.ts";
import { verifyConfig } from "./verify-config";
import { checkAllServices } from "./services/health";

// Setup telegram bot using the token from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is not set.");
}

const bot = new Bot(token);
let botRunner: ReturnType<typeof run> | undefined;

function getAllowedUserIdSet(): Set<number> {
    const raw = process.env.ALLOWED_USER_IDS?.split(",") || [];
    return new Set(
        raw
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isFinite(value))
    );
}

function getLocalizedThinkingStatus(text: string | undefined): string {
    const lang = detectStatusLanguage(text);
    return lang === "es" ? "⏳ _Pensando..._" : "⏳ _Thinking..._";
}

function getLocalizedCatchupStatus(text: string | undefined): string {
    const lang = detectStatusLanguage(text);
    return lang === "es"
        ? "👋 _Hola, volvi a estar en linea. Voy a retomar tu ultimo pedido..._"
        : "👋 _Hello! I'm back online. Let me catch up on your last request..._";
}

function extractUserTextFromHistoryMessage(message: any): string | undefined {
    if (!message || message.role !== "user") return undefined;
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
        const textPart = message.content.find((part: any) => part?.type === "text" && typeof part?.text === "string");
        return textPart?.text;
    }
    return undefined;
}

// Handle incoming /start command
bot.command("start", (ctx) => {
    ctx.reply(`👋 Hello! I am your *Agentic Media Bot*.

I help you manage your media library across:
✅ *Radarr* (Movies)
✅ *Sonarr* (TV Shows)
✅ *Plex* (Streaming)
✅ *qBittorrent* (Downloads)

How can I help you today?
/status - Check service health`, { parse_mode: "Markdown" });
});

// Handle /status command
bot.command("status", async (ctx) => {
    await ctx.replyWithChatAction("typing");
    const results = await checkAllServices();

    const message = results.map(s => {
        const icon = s.online ? "✅" : "❌";
        return `${icon} *${s.service}*: ${s.message}`;
    }).join("\n");

    await ctx.reply(`📡 *Service Status Report*\n\n${message}`, { parse_mode: "Markdown" });
});

// Handle /restart command (admin-only)
bot.command("restart", async (ctx) => {
    const userId = ctx.from.id;
    const allowedUserIds = getAllowedUserIdSet();

    if (allowedUserIds.size > 0 && !allowedUserIds.has(userId)) {
        await ctx.reply("You are not authorized to restart this bot.");
        return;
    }

    await ctx.reply("Restarting bot process...");

    setTimeout(() => {
        try {
            botRunner?.stop();
        } catch {
            // Ignore and exit anyway.
        }
        process.exit(0);
    }, 200);
});

// Handle text messages
bot.on("message:text", async (ctx) => {
    const userId = ctx.from.id;
    const user = ctx.from.username || ctx.from.first_name;
    console.log(`📩 Message from @${user} (${userId}): ${ctx.message.text}`);

    await ctx.replyWithChatAction("typing");

    // Create a status message to keep the user informed
    let statusMsg = await ctx.reply(getLocalizedThinkingStatus(ctx.message.text as string), { parse_mode: "Markdown" });

    const onStep = async (status: string) => {
        console.log(`🤖 Agent Update [@${user}]: ${status}`);
        try {
            await ctx.api.editMessageText(userId, statusMsg.message_id, status, { parse_mode: "Markdown" });
        } catch (err) {
            // Ignore errors if message is same or deleted
        }
    };

    const { text, imageUrl } = await processUserMessage(userId, ctx.message.text as string, onStep);

    // Clean up status message
    try {
        await ctx.api.deleteMessage(userId, statusMsg.message_id);
    } catch (err) {
        // Ignore
    }

    await safeReply(ctx, text, imageUrl, user);
});

/**
 * Sends a message or photo with Markdown parsing, 
 * falling back to plain text if parsing fails.
 */
async function safeReply(ctx: any, text: string, imageUrl: string | undefined, user: string | number) {
    try {
        if (imageUrl) {
            console.log(`🤖 Bot Reply Photo [@${user}]: ${imageUrl} - ${text.slice(0, 50)}...`);
            await ctx.replyWithPhoto(imageUrl, { caption: text, parse_mode: "Markdown" });
        } else {
            console.log(`🤖 Bot Reply Text [@${user}]: ${text.slice(0, 100)}${text.length > 100 ? "..." : ""}`);
            await ctx.reply(text, { parse_mode: "Markdown" });
        }
    } catch (error: any) {
        if (error.description && error.description.includes("can't parse entities")) {
            console.warn(`⚠️ Markdown parsing failed for [@${user}], retrying in plain text:`, error.description);
            if (imageUrl) {
                await ctx.replyWithPhoto(imageUrl, { caption: text });
            } else {
                await ctx.reply(text);
            }
        } else {
            throw error; // Rethrow other errors
        }
    }
}

bot.catch((err: unknown) => {
    console.error("Error in bot:", err);
});

console.log("Starting the bot...");

// Audit specs and verify config on every run
await verifyConfig();
// Audit specs and verify config on every run
await verifyConfig();

bot.api.getMe().then(async (me) => {
    console.log(`✅ Bot is online and listening as @${me.username}`);

    // Initial health check
    console.log("📡 performing initial service health check...");
    const results = await checkAllServices();
    results.forEach(s => {
        const icon = s.online ? "✅" : "❌";
        console.log(`${icon} ${s.service}: ${s.message}`);
    });

    // Changelog / Restart notification logic
    const adminIds = process.env.ALLOWED_USER_IDS?.split(",") || [];

    if (adminIds.length > 0) {
        const changelog = `
*Recent Changes:*
- **Warmer Status Updates**: More informative, localized status messages with friendly phrasing.
- **Localized Transition Banner**: Initial "Thinking" and catch-up status messages now match the user's language.
- **Exact Count Prefix**: Plex country/genre replies now always include the precise total found count.
- **Synthesis Count Fix**: Exact count now comes from first-pass tool results, so it is preserved even with capable-model synthesis.
- **Country Filter Accuracy**: Plex country filtering now normalizes full tag-key query paths to avoid mixed or unfiltered results.
- **Deterministic Country/Genre Replies**: Plex browse answers now render directly from tool data to prevent mismatched counts/titles.
- **Country Name Clarity**: Country search status now uses noun country names (e.g., "Germany") instead of demonyms.
- **Spanish Detection Robustness**: Language detection now handles Spanish inputs without accent marks (e.g., "peliculas").
- **Country Param Canonicalization**: findPlexByCountry now canonicalizes demonyms to country nouns at tool boundary.
- **Plex Filter Precision**: Direct Plex tag paths are now preferred and aggregated results are deduplicated across sections.
- **Country Canonicalization Unification**: Execution, status, and logs now share one country normalizer (e.g., Danish -> Denmark).
- **Strict Primary Country Filter**: Country browsing now validates each item’s primary "Country" tag and ignores language tags.
- **Title Country Verification**: Country yes/no answers now use Plex "primaryCountry" from title search metadata.
- **Ranked Country Lists**: "Top N from country" queries now request ranked results with explicit limit.
- **Deterministic Foreign Title Alias**: Country/genre list output now appends original title when it differs.
- **Metadata Title Enrichment**: Country ranked output now enriches aliases from Plex metadata ("originalTitle"/"titleSort") when possible.
- **Detail-Intent Safety Guard**: Detail/info requests now disable add tools unless explicit add intent is present.
- **Admin Restart Command**: Added `/restart` command to gracefully restart the bot process for allowed users.
- **Tool Guardrails**: Add-movie/series calls now gracefully prompt for a search match when IDs are missing.
- **Radarr Resilience**: Title-based adds now handle Radarr lookup errors without crashing.
- **Tool Error Containment**: Radarr search/add failures now return safe responses and keep the message flow alive.
- **Specification Audit**: Functional and Technical specs updated to match latest implementations.
`;
        // Create a simple hash of the changelog to track if we've already sent it
        const changelogHash = Buffer.from(changelog).toString("base64").slice(0, 32);
        const lastSentHash = getMetadata("last_sent_changelog_hash");

        if (lastSentHash !== changelogHash) {
            const isFirstStart = !lastSentHash;
            const message = isFirstStart
                ? "🚀 Bot has been initialized!"
                : "🔄 Bot has been updated!";

            for (const adminId of adminIds) {
                try {
                    await bot.api.sendMessage(adminId, `${message}\n${changelog}`, { parse_mode: "Markdown" });
                } catch (err) {
                    console.error(`Failed to send startup message to ${adminId}:`, err);
                }
            }
            setMetadata("last_sent_changelog_hash", changelogHash);
        }
    }

    // Catch-up logic for unreplied messages
    console.log("📥 Checking for unreplied messages...");
    await syncUnrepliedMessages();

    // Use grammyjs/runner to handle graceful restarts and long-polling concurrently
    botRunner = run(bot);

    console.log("🚀 Bot is ready for messages on Telegram.");
});

async function syncUnrepliedMessages() {
    const conversations = getAllConversations();
    for (const conv of conversations) {
        const history = conv.history;
        const lastMessage = history[history.length - 1];

        // If the last message is from a user, we haven't replied yet
        if (lastMessage && lastMessage.role === "user") {
            const userId = Number(conv.userId);
            const user = userId.toString();
            console.log(`⏳ Found unreplied message from ${userId}, processing retroactive response...`);

            try {
                // Send a notification that we're catching up
                const lastUserText = extractUserTextFromHistoryMessage(lastMessage);
                const statusMsg = await bot.api.sendMessage(userId, getLocalizedCatchupStatus(lastUserText), { parse_mode: "Markdown" });

                const onStep = async (status: string) => {
                    try {
                        await bot.api.editMessageText(userId, statusMsg.message_id, status, { parse_mode: "Markdown" });
                    } catch (err) {
                        // Ignore
                    }
                };

                // Process the message (passing undefined for userMessage since it's already in history)
                const { text, imageUrl } = await processUserMessage(userId, undefined, onStep);

                // Clean up status message
                try {
                    await bot.api.deleteMessage(userId, statusMsg.message_id);
                } catch (err) {
                    // Ignore
                }

                // Use the safeReply-like logic directly for the catch-up phase
                try {
                    if (imageUrl) {
                        await bot.api.sendPhoto(userId, imageUrl, { caption: text, parse_mode: "Markdown" });
                    } else {
                        await bot.api.sendMessage(userId, text, { parse_mode: "Markdown" });
                    }
                } catch (e) {
                    if (imageUrl) {
                        await bot.api.sendPhoto(userId, imageUrl, { caption: text });
                    } else {
                        await bot.api.sendMessage(userId, text);
                    }
                }
            } catch (err) {
                console.error(`Error in retroactive reply for user ${userId}:`, err);
            }
        }
    }
}
