import { Bot } from "grammy";
import { run } from "@grammyjs/runner";
import { resolve, isAbsolute } from "node:path";
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
const projectRoot = resolve(import.meta.dir, "..");
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

type ChangelogRelease = {
    version: string;
    changes: string[];
};

const CHANGELOG_RELEASES: ChangelogRelease[] = [
    {
        version: "3.0.0",
        changes: [
            "Semantic versioned changelog releases are now used instead of one rolling changelog block.",
            "Bot startup now sends only the latest release changelog to administrators.",
            "Startup changelog delivery remains chunked to respect Telegram message length limits.",
        ],
    },
];

function getAllowedUserIdSet(): Set<number> {
    const raw = process.env.ALLOWED_USER_IDS?.split(",") || [];
    return new Set(
        raw
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isFinite(value))
    );
}

function triggerExternalRestart(): boolean {
    const customRestartCommand = process.env.BOT_RESTART_COMMAND?.trim();
    try {
        if (customRestartCommand) {
            const child = Bun.spawn({
                cmd: ["sh", "-c", customRestartCommand],
                cwd: projectRoot,
                stdin: "ignore",
                stdout: "ignore",
                stderr: "ignore",
                detached: true,
            });
            child.unref();
            return true;
        } else {
            const entryScript = process.argv[1] || "src/bot.ts";
            const scriptPath = isAbsolute(entryScript)
                ? entryScript
                : resolve(projectRoot, entryScript);
            const restartScriptPath = resolve(projectRoot, "scripts/restart-bot.sh");
            const child = Bun.spawn({
                cmd: [
                    "sh",
                    restartScriptPath,
                    String(process.pid),
                    scriptPath,
                    process.execPath,
                    "/tmp/agentic-media-bot-restart.log",
                ],
                cwd: projectRoot,
                stdin: "ignore",
                stdout: "ignore",
                stderr: "ignore",
                detached: true,
            });
            child.unref();
            return true;
        }
    } catch (error) {
        console.error("Failed to spawn external restart supervisor:", error);
    }

    try {
        const entryScript = process.argv[1] || "src/bot.ts";
        const fallbackScript = isAbsolute(entryScript)
            ? entryScript
            : resolve(projectRoot, entryScript);
        const fallback = Bun.spawn({
            cmd: ["sh", "-c", `nohup "${process.execPath}" run "${fallbackScript}" >/tmp/agentic-media-bot-restart.log 2>&1 &`],
            cwd: projectRoot,
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            detached: true,
        });
        fallback.unref();
        console.log("✅ Restart fallback launched via nohup.");
        return true;
    } catch (fallbackError) {
        console.error("Failed to launch restart fallback:", fallbackError);
        return false;
    }
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

function splitTelegramMessage(text: string, maxLength = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let current = "";
    const lines = text.split("\n");

    for (const line of lines) {
        const candidate = current ? `${current}\n${line}` : line;
        if (candidate.length <= maxLength) {
            current = candidate;
            continue;
        }

        if (current) chunks.push(current);
        current = "";

        if (line.length <= maxLength) {
            current = line;
            continue;
        }

        for (let index = 0; index < line.length; index += maxLength) {
            chunks.push(line.slice(index, index + maxLength));
        }
    }

    if (current) chunks.push(current);
    return chunks;
}

function getLatestChangelogRelease(): ChangelogRelease {
    return CHANGELOG_RELEASES[CHANGELOG_RELEASES.length - 1];
}

function buildReleaseChangelogText(release: ChangelogRelease): string {
    const lines = release.changes.map((change) => `- ${change}`);
    return [`*Changelog v${release.version}*`, ...lines].join("\n");
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
    const userId = ctx.from?.id;
    if (typeof userId !== "number") {
        await ctx.reply("Cannot determine requesting user for authorization.");
        return;
    }
    const allowedUserIds = getAllowedUserIdSet();

    if (allowedUserIds.size > 0 && !allowedUserIds.has(userId)) {
        await ctx.reply("You are not authorized to restart this bot.");
        return;
    }

    await ctx.reply("Restarting bot process...");
    setMetadata("skip_catchup_once", "1");
    const restartNotifyChatId = ctx.chat?.id;
    if (typeof restartNotifyChatId === "number") {
        setMetadata("restart_notify_chat_id", String(restartNotifyChatId));
        const isSpanish = ctx.from?.language_code?.toLowerCase().startsWith("es");
        setMetadata("restart_notify_lang", isSpanish ? "es" : "en");
    }

    setTimeout(() => {
        try {
            botRunner?.stop();
        } catch (stopError) {
            console.error("Failed to stop bot runner before restart:", stopError);
        }

        const spawned = triggerExternalRestart();
        if (spawned) {
            process.exit(0);
            return;
        }

        // Fallback for environments where shell spawning is restricted.
        try {
            botRunner?.stop();
            botRunner = run(bot);
            console.log("✅ Bot runner restarted in-process via fallback.");
        } catch (fallbackError) {
            console.error("Failed to restart bot runner via fallback:", fallbackError);
        }
    }, 200);
});

// Handle text messages
bot.on("message:text", async (ctx) => {
    if (!ctx.from) return;
    if (ctx.message.text.startsWith("/")) return;
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

bot.api.getMe().then(async (me) => {
    console.log(`✅ Bot is online and listening as @${me.username}`);

    const restartNotifyChatId = Number(getMetadata("restart_notify_chat_id"));
    if (Number.isFinite(restartNotifyChatId) && restartNotifyChatId > 0) {
        const restartNotifyLang = getMetadata("restart_notify_lang");
        const message = restartNotifyLang === "es"
            ? "✅ Volví a estar en línea."
            : "✅ I am back online.";
        try {
            await bot.api.sendMessage(restartNotifyChatId, message);
        } catch (error) {
            console.error(`Failed to send restart notification to ${restartNotifyChatId}:`, error);
        } finally {
            setMetadata("restart_notify_chat_id", "");
            setMetadata("restart_notify_lang", "");
        }
    }

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
        const latestRelease = getLatestChangelogRelease();
        const startupTitle = "🔄 Bot startup changelog";
        const startupText = `${startupTitle}\n${buildReleaseChangelogText(latestRelease)}`;

        for (const adminId of adminIds) {
            try {
                const chunks = splitTelegramMessage(startupText);
                for (const chunk of chunks) {
                    await bot.api.sendMessage(adminId, chunk);
                }
            } catch (err) {
                console.error(`Failed to send startup message to ${adminId}:`, err);
            }
        }

        setMetadata("last_sent_changelog_version", latestRelease.version);
    }

    // Catch-up logic for unreplied messages
    const skipCatchupOnce = getMetadata("skip_catchup_once") === "1";
    if (skipCatchupOnce) {
        setMetadata("skip_catchup_once", "0");
        console.log("⏭️ Skipping catch-up once after admin restart.");
    } else {
        console.log("📥 Checking for unreplied messages...");
        await syncUnrepliedMessages();
    }

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
