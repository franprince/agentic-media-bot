import { Api, Bot, Context, InlineKeyboard, InputFile, GrammyError, type RawApi } from "grammy";
import { run } from "@grammyjs/runner";
import { resolve, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { processUserMessage } from "./agent/index.ts";
import { detectStatusLanguage } from "./agent/status.ts";
import { getMetadata, setMetadata, deleteMetadata, getAllConversations, getUserName, setUserName, areNotificationsEnabled, setNotificationsEnabled, getRecentMediaEvents, setEventAlertConfig, getTimezone, formatEventTimestamp, getAllReportSubscriptions, type ReportSubscription, getLocalWatchlist } from "./services/database.ts";
import cron from "node-cron";
import { registerSubscriptionChangedCallback } from "./services/scheduler";

import { verifyConfig } from "./verify-config";
import { checkAllServices } from "./services/health";
import { handlePlexWebhook, handleRadarrWebhook, handleSonarrWebhook, handleNZBGetWebhook } from "./services/webhooks.ts";
import * as sonarr from "./services/sonarr";
import * as plex from "./services/plex";
import * as radarr from "./services/radarr";
import { formatBytes } from "./agent/tools";
import { transcribeAudio } from "./services/transcription";




// Setup telegram bot using the token from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is not set.");
}

const bot = new Bot(token);
let botRunner: ReturnType<typeof run> | undefined;
const projectRoot = resolve(import.meta.dir, "..");
const INSTANCE_ID = randomUUID();
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT) || 3000;

// Conversation state for name collection
type WaitingForNameState = { waitingForName: true };
const waitingForName = new Map<number, WaitingForNameState>();

type ChangelogRelease = {
    version: string;
    changes: string[];
};

/**
 * Parses CHANGELOG.md to extract version and changes.
 * Single source of truth.
 */
async function getChangelogFromFile(): Promise<ChangelogRelease[]> {
    try {
        let changelogPath = resolve(import.meta.dir, "CHANGELOG.md");
        let file = Bun.file(changelogPath);
        if (!(await file.exists())) {
            changelogPath = resolve(projectRoot, "CHANGELOG.md");
            file = Bun.file(changelogPath);
            if (!(await file.exists())) return [];
        }

        const text = await file.text();
        const releases: ChangelogRelease[] = [];
        const sections = text.split(/^## \[/m).slice(1);

        for (const section of sections) {
            const versionMatch = section.match(/^([^\]]+)\]/);
            if (!versionMatch) continue;

            const version = versionMatch[1] as string;
            const changes: string[] = [];

            // Extract bullet points from the section
            const lines = section.split("\n");
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith("- ")) {
                    changes.push(trimmed.substring(2));
                }
            }

            if (changes.length > 0) {
                releases.push({ version, changes });
            }
        }
        return releases;
    } catch (err) {
        console.error("Failed to parse CHANGELOG.md:", err);
        return [];
    }
}

/**
 * Robust semver comparison (v1 > v2)
 */
function isNewerVersion(v1: string, v2: string): boolean {
    if (!v2) return true;
    const p1 = v1.split(".").map(Number);
    const p2 = v2.split(".").map(Number);

    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
        const n1 = p1[i] || 0;
        const n2 = p2[i] || 0;
        if (n1 > n2) return true;
        if (n1 < n2) return false;
    }
    return false;
}

/**
 * Atomic instance check using database metadata.
 * Returns true if this instance should become the leader.
 */
function acquireInstanceLock(): boolean {
    const activePid = getMetadata("active_instance_pid");
    const activeId = getMetadata("active_instance_id");
    const now = Date.now();
    const heartbeat = Number(getMetadata("instance_heartbeat") || 0);

    // If no active PID, we can take over.
    if (!activePid || !activeId) {
        setMetadata("active_instance_id", INSTANCE_ID);
        setMetadata("active_instance_pid", String(process.pid));
        setMetadata("instance_heartbeat", String(now));
        return true;
    }

    const pid = Number(activePid);
    let running = false;
    try {
        // process.kill(pid, 0) checks if the process exists without killing it
        running = process.kill(pid, 0);
    } catch (e) {
        running = false;
    }

    // If it's already us (same random ID), just update heartbeat and return true
    if (activeId === INSTANCE_ID) {
        setMetadata("instance_heartbeat", String(now));
        return true;
    }

    // If the PID in the database matches our current PID, it means the previous
    // instance used this same PID slot (common in containers where the bot is PID 1).
    // Since we are running now, that previous instance is definitely gone.
    if (pid === process.pid) {
        console.warn(`⚠️ [${INSTANCE_ID}] Previous instance used the same PID (${pid}). Taking over lock.`);
        setMetadata("active_instance_id", INSTANCE_ID);
        setMetadata("instance_heartbeat", String(now));
        return true;
    }

    // If the process is not running at all, we can safely take over
    if (!running) {
        console.log(`⚠️ [${INSTANCE_ID}] Previous instance (PID ${pid}) is no longer running. Taking over lock.`);
        setMetadata("active_instance_id", INSTANCE_ID);
        setMetadata("active_instance_pid", String(process.pid));
        setMetadata("instance_heartbeat", String(now));
        return true;
    }

    // If process is running, check heartbeat.
    // Allow 2 minutes of staleness (120000ms)
    const isHeartbeatStale = (now - heartbeat > 120000);
    const isHeartbeatInFuture = (heartbeat - now > 300000);

    if (isHeartbeatStale || isHeartbeatInFuture) {
        console.warn(`⚠️ [${INSTANCE_ID}] Instance PID ${pid} is running but heartbeat is ${isHeartbeatInFuture ? 'in the future' : 'stale'}. Overriding lock.`);
        setMetadata("active_instance_id", INSTANCE_ID);
        setMetadata("active_instance_pid", String(process.pid));
        setMetadata("instance_heartbeat", String(now));
        return true;
    }

    return false;
}

/**
 * Handle global 409 conflict errors specifically.
 */
function setupConflictHandling() {
    bot.catch(async (err) => {
        const error = err.error;
        const msg = err.message;
        if ((error instanceof GrammyError && error.error_code === 409) || (msg && msg.includes("409"))) {
            console.error("⛔ [409 Conflict] Another bot instance is polling. This instance will exit to resolve the conflict.");
            const activeId = getMetadata("active_instance_id");
            if (activeId !== INSTANCE_ID) {
                console.error(`Status: current ID ${INSTANCE_ID} does not match lock owner ${activeId}. Exit.`);
                process.exit(1);
            }
            process.exit(1);
        }
        console.error("Error in bot:", err);
    });
}

function startHeartbeat() {
    setInterval(() => {
        const currentActiveId = getMetadata("active_instance_id");

        if (currentActiveId && currentActiveId !== INSTANCE_ID) {
            console.error(`\n🛑 [${INSTANCE_ID}] Detected takeover by new instance (${currentActiveId}). Shutting down gracefully.`);
            process.exit(0);
        }

        setMetadata("instance_heartbeat", String(Date.now()));
    }, 30000); // Every 30 seconds
}

// Graceful shutdown handlers
function setupSignalHandlers() {
    const shutdown = () => {
        console.log(`\n🛑 [${INSTANCE_ID}] Received shutdown signal. Cleaning up...`);
        const currentActiveId = getMetadata("active_instance_id");
        if (currentActiveId === INSTANCE_ID) {
            deleteMetadata("active_instance_id");
            deleteMetadata("active_instance_pid");
            deleteMetadata("instance_heartbeat");
            console.log("✅ Instance lock cleared.");
        }
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}


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

async function getLatestChangelogRelease(): Promise<ChangelogRelease> {
    const releases = await getChangelogFromFile();
    const latest = releases[0]; // Assuming newest is first in CHANGELOG.md
    if (!latest) {
        throw new Error("No changelog releases found in CHANGELOG.md");
    }
    return latest;
}

function buildReleaseChangelogText(release: ChangelogRelease): string {
    const lines = release.changes.map((change) => `- ${change}`);
    return [`*Changelog v${release.version}*`, ...lines].join("\n");
}

// Handle incoming /start command
bot.command("start", async (ctx) => {
    if (!ctx.from) return;

    const userId = ctx.from.id;
    const existingName = getUserName(userId);

    if (existingName) {
        // User already has a name, show welcome back message
        await ctx.reply(`👋 Welcome back, *${existingName}*! I am your *Agentic Media Bot*.

I help you manage your media library across:
✅ *Radarr* (Movies)
✅ *Sonarr* (TV Shows)
✅ *Plex* (Streaming)
✅ *qBittorrent* (Downloads)

How can I help you today?
/status - Check service health`, { parse_mode: "Markdown" });
        return;
    }

    // First time user, ask for their name
    waitingForName.set(userId, { waitingForName: true });
    await ctx.reply(`👋 Hello! I am your *Agentic Media Bot*.
    
    I help you manage your media library across:
    ✅ *Radarr* (Movies)
    ✅ *Sonarr* (TV Shows)
    ✅ *Plex* (Streaming)
    ✅ *qBittorrent* (Downloads)

    _If you haven't configured the bot yet, please run \`bun src/setup.ts\` on your server._

    What should I call you?`, { parse_mode: "Markdown" });
});

// Handle /help command
bot.command("help", async (ctx) => {
    const helpMessage = `🤖 *Agentic Media Bot - Help*

I am an AI-powered media manager that understands natural language. You can talk to me normally to find, add, or manage your media.

*Available Commands:*
🚀 /start - Initial setup and welcome
📡 /status - Check health of all connected services
🎬 /radarr - View recent movie events & manage alerts
📺 /sonarr - View recent series events & manage alerts
🍿 /plex - View recent Plex events & manage alerts
🔔 /notifications <on/off> - Toggle all alerts globally
🔄 /restart - Restart the bot (Admin only)
🔍 /audit - Diagnostic logs (Admin only)
❓ /help - Show this help message

*Key Features:*
• *Natural Language*: "Search for Action movies from Japan", "Add Inception to Radarr", "What are some good sci-fi shows?"
• *Plex Discovery*: Search by genre, country, or duration across your libraries.
• *Media Management*: Add or remove content from Radarr and Sonarr with interactive confirmations (Inline Buttons).
• *Real-time Alerts*: Get notified when media is grabbed, downloaded, or when someone starts watching on Plex.
• *Multilingual Support*: Handles non-Latin titles and translated metadata.

_Tip: You can just ask me "Find me some short horror movies from the 90s" and I'll do the rest!_`;

    await ctx.reply(helpMessage, { parse_mode: "Markdown" });
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

// Handle /notifications command (admin-only)
bot.command("notifications", async (ctx) => {
    const userId = ctx.from?.id;
    if (typeof userId !== "number") {
        await ctx.reply("Cannot determine requesting user for authorization.");
        return;
    }
    const allowedUserIds = getAllowedUserIdSet();

    if (allowedUserIds.size > 0 && !allowedUserIds.has(userId)) {
        await ctx.reply("You are not authorized to change notification settings.");
        return;
    }

    const arg = ctx.match?.trim().toLowerCase();
    if (arg === "on") {
        setNotificationsEnabled(true);
        await ctx.reply("✅ Plex notifications enabled.");
    } else if (arg === "off") {
        setNotificationsEnabled(false);
        await ctx.reply("❌ Plex notifications disabled.");
    } else {
        const enabled = areNotificationsEnabled();
        await ctx.reply(`Plex notifications are currently *${enabled ? "enabled" : "disabled"}*.\n\nUse \`/notifications on\` or \`/notifications off\` to change.`, { parse_mode: "Markdown" });
    }
});

// Handle /radarr command
bot.command("radarr", async (ctx) => {
    const userId = ctx.from?.id;
    if (typeof userId !== "number") {
        await ctx.reply("Cannot determine requesting user for authorization.");
        return;
    }
    const allowedUserIds = getAllowedUserIdSet();

    if (allowedUserIds.size > 0 && !allowedUserIds.has(userId)) {
        await ctx.reply("You are not authorized.");
        return;
    }

    const args = ctx.match?.trim().toLowerCase().split(/\s+/);
    if (args && args[0] === "alerts") {
        const eventType = args[1];
        const state = args[2];
        if (eventType && (state === "on" || state === "off")) {
            const enabled = state === "on";
            setEventAlertConfig("radarr", eventType, enabled);
            await ctx.reply(`✅ Radarr *${eventType}* alerts turned *${state}*.`, { parse_mode: "Markdown" });
            return;
        } else {
            await ctx.reply("Usage: `/radarr alerts <grab|download> <on|off>`", { parse_mode: "Markdown" });
            return;
        }
    }

    const events = getRecentMediaEvents("radarr", 10);
    if (events.length === 0) {
        await ctx.reply("No recent Radarr events found.");
        return;
    }

    let report = "🎬 *Recent Radarr Events*\n\n";
    for (const ev of events) {
        const dateStr = formatEventTimestamp(ev.timestamp);
        report += `[${dateStr}] *${ev.event_type.toUpperCase()}* - ${ev.title}\n`;
    }

    await ctx.reply(report, { parse_mode: "Markdown" });
});

// Handle /sonarr command
bot.command("sonarr", async (ctx) => {
    const userId = ctx.from?.id;
    if (typeof userId !== "number") {
        await ctx.reply("Cannot determine requesting user for authorization.");
        return;
    }
    const allowedUserIds = getAllowedUserIdSet();

    if (allowedUserIds.size > 0 && !allowedUserIds.has(userId)) {
        await ctx.reply("You are not authorized.");
        return;
    }

    const args = ctx.match?.trim().toLowerCase().split(/\s+/);
    if (args && args[0] === "alerts") {
        const eventType = args[1];
        const state = args[2];
        if (eventType && (state === "on" || state === "off")) {
            const enabled = state === "on";
            setEventAlertConfig("sonarr", eventType, enabled);
            await ctx.reply(`✅ Sonarr *${eventType}* alerts turned *${state}*.`, { parse_mode: "Markdown" });
            return;
        } else {
            await ctx.reply("Usage: `/sonarr alerts <grab|download|seriesadd> <on|off>`", { parse_mode: "Markdown" });
            return;
        }
    }

    const events = getRecentMediaEvents("sonarr", 10);
    if (events.length === 0) {
        await ctx.reply("No recent Sonarr events found.");
        return;
    }

    let report = "📺 *Recent Sonarr Events*\n\n";
    for (const ev of events) {
        const dateStr = formatEventTimestamp(ev.timestamp);
        report += `[${dateStr}] *${ev.event_type.toUpperCase()}* - ${ev.title}\n`;
    }

    await ctx.reply(report, { parse_mode: "Markdown" });
});

// Handle /plex command
bot.command("plex", async (ctx) => {
    const userId = ctx.from?.id;
    if (typeof userId !== "number") {
        await ctx.reply("Cannot determine requesting user for authorization.");
        return;
    }
    const allowedUserIds = getAllowedUserIdSet();

    if (allowedUserIds.size > 0 && !allowedUserIds.has(userId)) {
        await ctx.reply("You are not authorized.");
        return;
    }

    const args = ctx.match?.trim().toLowerCase().split(/\s+/);
    if (args && args[0] === "alerts") {
        const eventType = args[1];
        const state = args[2];
        
        // Map shorthand names to actual Plex webhook events
        const eventMapping: Record<string, string> = {
            play: "media.play",
            resume: "media.resume",
            scrobble: "media.scrobble",
            library: "library.new"
        };
        
        const actualEvent = eventMapping[eventType] || eventType;

        if (eventType && (actualEvent === "media.play" || actualEvent === "media.resume" || actualEvent === "media.scrobble" || actualEvent === "library.new") && (state === "on" || state === "off")) {
            const enabled = state === "on";
            setEventAlertConfig("plex", actualEvent, enabled);
            await ctx.reply(`✅ Plex *${eventType}* alerts turned *${state}*.`, { parse_mode: "Markdown" });
            return;
        } else {
            await ctx.reply("Usage: `/plex alerts <play|resume|scrobble|library> <on|off>`", { parse_mode: "Markdown" });
            return;
        }
    }

    const events = getRecentMediaEvents("plex", 10);
    if (events.length === 0) {
        await ctx.reply("No recent Plex events found.");
        return;
    }

    let report = "🍿 *Recent Plex Events*\n\n";
    for (const ev of events) {
        const dateStr = formatEventTimestamp(ev.timestamp);
        report += `[${dateStr}] *${ev.event_type.toUpperCase()}* - ${ev.title}\n`;
    }

    await ctx.reply(report, { parse_mode: "Markdown" });
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

// Handle /audit command (admin-only)
bot.command("audit", async (ctx) => {
    const userId = ctx.from?.id;
    if (typeof userId !== "number") {
        await ctx.reply("Cannot determine requesting user for authorization.");
        return;
    }
    const allowedUserIds = getAllowedUserIdSet();

    if (allowedUserIds.size > 0 && !allowedUserIds.has(userId)) {
        await ctx.reply("You are not authorized to audit this bot.");
        return;
    }

    await ctx.reply("🔍 *Running Bot Audit...*", { parse_mode: "Markdown" });

    try {
        const logPath = "/tmp/agentic-media-bot-restart.log";
        const file = Bun.file(logPath);
        if (await file.exists()) {
            const text = await file.text();
            const lines = text.split("\n");
            const lastLines = lines.slice(-50).join("\n");

            // Look for errors or crashes
            const hasError = text.toLowerCase().includes("error") || text.toLowerCase().includes("typeerror") || text.toLowerCase().includes("conflict");

            let report = `📊 *Bot Audit Report*\n\n`;
            report += `Instance PID: \`${process.pid}\`\n`;
            report += `Uptime: \`${Math.floor(process.uptime())}s\`\n`;
            report += `Detected Errors: ${hasError ? "⚠️ *YES*" : "✅ *NO*"}\n\n`;
            report += `*Last log entries:*\n\`\`\`\n${lastLines.slice(-3000)}\n\`\`\``;

            const chunks = splitTelegramMessage(report);
            for (const chunk of chunks) {
                await ctx.reply(chunk, { parse_mode: "Markdown" });
            }

            if (hasError) {
                await ctx.reply("🛠️ *Repair required?* You can ask Antigravity (Assistant) to review these logs and apply a fix.");
            }
        } else {
            await ctx.reply("❌ Log file not found at /tmp/agentic-media-bot-restart.log");
        }
    } catch (error) {
        console.error("Audit failed:", error);
        await ctx.reply("❌ Failed to perform audit. Check server console.");
    }
});

// Handle /watchlist command
bot.command("watchlist", async (ctx) => {
    const userId = ctx.from?.id;
    if (typeof userId !== "number") {
        await ctx.reply("Cannot determine requesting user for authorization.");
        return;
    }
    const allowedUserIds = getAllowedUserIdSet();

    if (allowedUserIds.size > 0 && !allowedUserIds.has(userId)) {
        await ctx.reply("You are not authorized to view the watchlist.");
        return;
    }

    await ctx.reply("⏳ *Fetching watchlist...*", { parse_mode: "Markdown" });

    try {
        // Sync watchlist to ensure fresh results
        await plex.syncWatchlist();
        const list = getMetadata("last_sent_changelog_version") ? getRecentMediaEvents("Plex", 1) : []; // simple dummy load or import check
        const watchlist = getLocalWatchlist();
        
        if (watchlist.length === 0) {
            await ctx.reply("Your watchlist is currently empty.");
            return;
        }

        let report = `🍿 *Your Watchlist*\n\n`;
        watchlist.forEach((item, index) => {
            const typeIcon = item.media_type === "movie" ? "🎬" : "📺";
            const statusIcon = item.status === "completed" ? "✅" : (item.status === "downloading" ? "⏳" : "▫️");
            report += `${index + 1}. ${typeIcon} *${item.title}* (${item.media_type})\n   Status: \`${item.status}\` ${statusIcon}\n\n`;
        });

        const chunks = splitTelegramMessage(report);
        for (const chunk of chunks) {
            await ctx.reply(chunk, { parse_mode: "Markdown" });
        }
    } catch (error: any) {
        console.error("Failed to list watchlist:", error);
        await ctx.reply(`❌ Failed to retrieve watchlist: ${error.message || "Unknown error"}`);
    }
});

// Handle /watchlist_sync command
bot.command("watchlist_sync", async (ctx) => {
    const userId = ctx.from?.id;
    if (typeof userId !== "number") {
        await ctx.reply("Cannot determine requesting user for authorization.");
        return;
    }
    const allowedUserIds = getAllowedUserIdSet();

    if (allowedUserIds.size > 0 && !allowedUserIds.has(userId)) {
        await ctx.reply("You are not authorized to sync the watchlist.");
        return;
    }

    const statusMsg = await ctx.reply("🔄 *Synchronizing watchlist with Plex Discover...*", { parse_mode: "Markdown" });

    try {
        const syncResult = await plex.syncWatchlist();
        await ctx.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `✅ *Watchlist synchronization complete!*\n\nAdded: *${syncResult.added}* new item(s)\nRemoved: *${syncResult.removed}* item(s) no longer in Plex Watchlist.`,
            { parse_mode: "Markdown" }
        );
    } catch (error: any) {
        console.error("Failed to sync watchlist:", error);
        try {
            await ctx.api.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                `❌ *Watchlist synchronization failed:*\n${error.message || "Unknown error"}`,
                { parse_mode: "Markdown" }
            );
        } catch (_) {
            await ctx.reply(`❌ Failed to sync watchlist: ${error.message || "Unknown error"}`);
        }
    }
});

// Handle /storage command
bot.command("storage", async (ctx) => {
    const userId = ctx.from?.id;
    if (typeof userId !== "number") {
        await ctx.reply("Cannot determine requesting user for authorization.");
        return;
    }
    const allowedUserIds = getAllowedUserIdSet();

    if (allowedUserIds.size > 0 && !allowedUserIds.has(userId)) {
        await ctx.reply("You are not authorized to check storage.");
        return;
    }

    await ctx.reply("💾 *Checking storage usage...*", { parse_mode: "Markdown" });

    try {
        const radarrFolders = await radarr.getRootFolders().catch(() => []);
        const sonarrFolders = await sonarr.getRootFolders().catch(() => []);

        let report = `💾 *Storage Information*\n\n`;

        if (radarrFolders.length > 0) {
            report += `🎬 *Radarr:*\n`;
            radarrFolders.forEach(f => {
                report += `▫️ \`${f.path}\`: *${formatBytes(f.freeSpace)}* free\n`;
            });
            report += `\n`;
        }

        if (sonarrFolders.length > 0) {
            report += `📺 *Sonarr:*\n`;
            sonarrFolders.forEach(f => {
                report += `▫️ \`${f.path}\`: *${formatBytes(f.freeSpace)}* free\n`;
            });
        }

        if (radarrFolders.length === 0 && sonarrFolders.length === 0) {
            report = `❌ Could not retrieve storage folders from Radarr or Sonarr.`;
        }

        await ctx.reply(report, { parse_mode: "Markdown" });
    } catch (error: any) {
        console.error("Failed to check storage:", error);
        await ctx.reply(`❌ Failed to retrieve storage info: ${error.message || "Unknown error"}`);
    }
});

// Handle text messages
bot.on("message:text", async (ctx) => {
    if (!ctx.from) return;

    const userId = ctx.from.id;

    // Check if we're waiting for a name
    if (waitingForName.has(userId)) {
        const name = ctx.message.text.trim();
        if (name.length > 0 && !name.startsWith("/")) {
            setUserName(userId, name);
            waitingForName.delete(userId);
            await ctx.reply(`Nice to meet you, *${name}*! 🎉

I help you manage your media library across:
✅ *Radarr* (Movies)
✅ *Sonarr* (TV Shows)
✅ *Plex* (Streaming)
✅ *qBittorrent* (Downloads)

How can I help you today?
/status - Check service health`, { parse_mode: "Markdown" });
            return;
        }
    }

    const user = ctx.from.username || ctx.from.first_name;
    await handleUserText(ctx, userId, ctx.message.text as string, user);
});

// Handle voice messages
bot.on("message:voice", async (ctx) => {
    if (!ctx.from) return;

    const userId = ctx.from.id;
    const allowedUserIds = getAllowedUserIdSet();

    if (allowedUserIds.size > 0 && !allowedUserIds.has(userId)) {
        await ctx.reply("You are not authorized to interact with this bot.");
        return;
    }

    const username = ctx.from.username || ctx.from.first_name;
    const statusMsg = await ctx.reply("🎙️ *Transcribing voice message...*", { parse_mode: "Markdown" });

    try {
        await ctx.replyWithChatAction("record_voice");

        const voice = ctx.message.voice;
        const file = await ctx.getFile();
        const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        const res = await fetch(fileUrl);
        if (!res.ok) {
            throw new Error(`Failed to download voice file: ${res.statusText}`);
        }
        const audioBuffer = await res.arrayBuffer();

        const transcription = await transcribeAudio(audioBuffer, voice.mime_type || "audio/ogg");
        
        if (!transcription || transcription.trim().length === 0) {
            await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, "❌ I couldn't hear any speech in that voice message.");
            return;
        }

        // Edit status message to show transcription in italics
        await ctx.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `🗣️ _"${transcription}"_`,
            { parse_mode: "Markdown" }
        );

        // Process transcription just like user typed it
        await handleUserText(ctx, userId, transcription, username);
    } catch (error: any) {
        console.error("Failed to transcribe voice note:", error);
        let msg = error.message || "Unknown error";
        // Only surface a Gemini-specific hint when no custom transcription endpoint is configured
        // and the error is clearly about an API key, to avoid misleading Whisper users.
        const usingCustomTranscription = !!process.env.TRANSCRIPTION_URL
            || process.env.AI_PROVIDER === "ollama"
            || process.env.AI_PROVIDER === "openai";
        if (!usingCustomTranscription && (msg.toLowerCase().includes("api key") || msg.toLowerCase().includes("apikey"))) {
            msg = "API key not valid. Please ensure GOOGLE_GENERATIVE_AI_API_KEY is configured with a valid Gemini API key in your .env.local file.";
        }
        await ctx.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `❌ *Transcription failed:* ${msg}`
        ).catch(() => {
            ctx.reply(`❌ Transcription failed: ${msg}`);
        });
    }
});

async function handleUserText(ctx: any, userId: number, userText: string, username: string | number) {
    if (userText.startsWith("/")) return;
    console.log(`📩 Message from @${username} (${userId}): ${userText}`);

    await ctx.replyWithChatAction("typing");

    // Create a status message to keep the user informed
    let statusMsg = await ctx.api.sendMessage(userId, getLocalizedThinkingStatus(userText), { parse_mode: "Markdown" });

    const onStep = async (status: string) => {
        console.log(`🤖 Agent Update [@${username}]: ${status}`);
        try {
            await ctx.api.editMessageText(userId, statusMsg.message_id, status, { parse_mode: "Markdown" });
        } catch (err) {
            // Ignore errors if message is same or deleted
        }
    };

    const { text, imageUrl, buttons } = await processUserMessage(userId, userText, onStep);

    // Clean up status message
    try {
        await ctx.api.deleteMessage(userId, statusMsg.message_id);
    } catch (err) {
        // Ignore
    }

    await safeReply(ctx, text, imageUrl, username, buttons);
}

/**
 * Handle button clicks by re-routing the callback data to the agent.
 */
bot.on("callback_query:data", async (ctx) => {
    const userId = ctx.from.id;
    const userText = ctx.callbackQuery.data;
    const username = ctx.from.username || ctx.from.first_name;

    // Answer the callback to remove loading state in Telegram
    await ctx.answerCallbackQuery();

    // Acknowledge the click in the chat if possible, or just process it
    // We send it to the agent as if the user typed it.
    await handleUserText(ctx, userId, userText, username);
});

/**
 * Handles sending a photo by checking if the URL is local (localhost)
 * and fetching it into an InputFile if necessary.
 */
async function sendPhotoSmart(ctx: any, userId: number | string, imageUrl: string | undefined, options: any) {
    if (!imageUrl) return;

    const isLocal = imageUrl.includes("localhost") || imageUrl.includes("127.0.0.1");

    if (isLocal) {
        try {
            const response = await fetch(imageUrl);
            if (response.ok) {
                const buffer = await response.arrayBuffer();
                // Extract original filename or use default
                const urlPart = imageUrl.split("?")[0]?.split("/").pop() ?? "";
                const extension = urlPart.includes(".") ? (urlPart.split(".").pop() ?? "jpg") : "jpg";
                const filename = `thumb.${extension}`;

                return await ctx.api.sendPhoto(userId, new InputFile(Buffer.from(buffer), filename), options);
            }
        } catch (err) {
            console.warn(`⚠️ Failed to fetch local image: ${imageUrl}. Falling back to remote or text.`, (err as Error).message);
        }
    }

    // Default: Send as URL
    return await ctx.api.sendPhoto(userId, imageUrl, options);
}

/**
 * Sends a message or photo with Markdown parsing, 
 * falling back to plain text if parsing fails.
 */
async function safeReply(
    ctx: any,
    text: string,
    imageUrl: string | undefined,
    user: string | number,
    buttons?: Array<{ text: string, data: string }>
) {
    const keyboard = buttons && buttons.length > 0
        ? new InlineKeyboard()
        : undefined;

    if (keyboard && buttons) {
        buttons.forEach((btn, index) => {
            keyboard.text(btn.text, btn.data);
            if ((index + 1) % 1 === 0) keyboard.row(); // One button per row for better readability
        });
    }

    try {
        if (imageUrl) {
            console.log(`🤖 Bot Reply Photo [@${user}]: ${imageUrl} - ${text.slice(0, 50)}...`);
            await sendPhotoSmart(ctx, ctx.chat.id, imageUrl, {
                caption: text,
                parse_mode: "Markdown",
                reply_markup: keyboard
            });
        } else {
            console.log(`🤖 Bot Reply Text [@${user}]: ${text.slice(0, 100)}${text.length > 100 ? "..." : ""}`);
            await ctx.reply(text, {
                parse_mode: "Markdown",
                reply_markup: keyboard
            });
        }
    } catch (error: any) {
        if (error.description && error.description.includes("can't parse entities")) {
            console.warn(`⚠️ Markdown parsing failed for [@${user}], retrying in plain text:`, error.description);
            if (imageUrl) {
                await sendPhotoSmart(ctx, ctx.chat.id, imageUrl, {
                    caption: text,
                    reply_markup: keyboard
                });
            } else {
                await ctx.reply(text, {
                    reply_markup: keyboard
                });
            }
        } else {
            throw error;
        }
    }
}

bot.catch((err: unknown) => {
    console.error("Error in bot:", err);
});

console.log("Starting the bot...");

function startWeeklySummaryCron() {
    const tz = getTimezone();
    console.log(`⏰ Starting weekly summary cron with timezone: ${tz}`);
    cron.schedule("0 18 * * 5", async () => {
        const adminIds = getAllowedUserIdSet();
        if (adminIds.size === 0) return;

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const radarrEvents = getRecentMediaEvents("radarr", 100, sevenDaysAgo);
        const sonarrEvents = getRecentMediaEvents("sonarr", 100, sevenDaysAgo);

        if (radarrEvents.length === 0 && sonarrEvents.length === 0) {
            return; // Nothing to report
        }

        let summary = "📊 *Weekly Media Summary*\n\n";

        if (radarrEvents.length > 0) {
            summary += `🎬 *Radarr* (${radarrEvents.length} events)\n`;
            const grabs = radarrEvents.filter(e => e.event_type === "grab").length;
            const downloads = radarrEvents.filter(e => e.event_type === "download").length;
            summary += `▫️ Grabbed: ${grabs}\n▫️ Downloaded: ${downloads}\n\n`;
        }

        if (sonarrEvents.length > 0) {
            summary += `📺 *Sonarr* (${sonarrEvents.length} events)\n`;
            const grabs = sonarrEvents.filter(e => e.event_type === "grab").length;
            const downloads = sonarrEvents.filter(e => e.event_type === "download").length;
            summary += `▫️ Grabbed: ${grabs}\n▫️ Downloaded: ${downloads}\n\n`;
        }

        summary += `_You can manage immediate alerts with_\n\`/radarr alerts <grab|download> <on|off>\`\n\`/sonarr alerts <grab|download> <on|off>\``;

        for (const adminId of adminIds) {
            try {
                await bot.api.sendMessage(adminId, summary, { parse_mode: "Markdown" });
            } catch (err) {
                console.error(`Failed to send weekly summary to ${adminId}:`, err);
            }
        }
    }, {
        timezone: tz
    });
}

const activeReportCrons = new Map<number, cron.ScheduledTask>();

export async function sendSummaryReport(userId: number, days: number = 7) {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    const radarrEvents = [
        ...getRecentMediaEvents("radarr", 100, sinceDate),
        ...getRecentMediaEvents("Radarr", 100, sinceDate)
    ];
    const sonarrEvents = [
        ...getRecentMediaEvents("sonarr", 100, sinceDate),
        ...getRecentMediaEvents("Sonarr", 100, sinceDate)
    ];

    if (radarrEvents.length === 0 && sonarrEvents.length === 0) {
        await bot.api.sendMessage(userId, `📊 *Summary Report (${days} days)*\n\nNo media activity was recorded during this period.`, { parse_mode: "Markdown" }).catch(e => {
            console.error(`Failed to send empty summary report to user ${userId}:`, e);
        });
        return;
    }

    let summary = `📊 *Summary Report (${days} days)*\n\n`;

    if (radarrEvents.length > 0) {
        summary += `🎬 *Radarr* (${radarrEvents.length} events)\n`;
        const grabs = radarrEvents.filter(e => e.event_type === "grab").length;
        const downloads = radarrEvents.filter(e => e.event_type === "download").length;
        summary += `▫️ Grabbed: ${grabs}\n▫️ Downloaded: ${downloads}\n\n`;
    }

    if (sonarrEvents.length > 0) {
        summary += `📺 *Sonarr* (${sonarrEvents.length} events)\n`;
        const grabs = sonarrEvents.filter(e => e.event_type === "grab").length;
        const downloads = sonarrEvents.filter(e => e.event_type === "download").length;
        summary += `▫️ Grabbed: ${grabs}\n▫️ Downloaded: ${downloads}\n\n`;
    }

    summary += `_You can manage immediate alerts with_\n\`/radarr alerts <grab|download> <on|off>\`\n\`/sonarr alerts <grab|download> <on|off>\``;

    await bot.api.sendMessage(userId, summary, { parse_mode: "Markdown" }).catch(e => {
        console.error(`Failed to send summary report to user ${userId}:`, e);
    });
}

export function reloadReportSubscriptions() {
    const tz = getTimezone();
    console.log(`⏰ Reloading dynamic report subscriptions with timezone: ${tz}`);

    for (const [id, task] of activeReportCrons.entries()) {
        try {
            task.stop();
        } catch (e) {
            console.error(`Failed to stop cron task ${id}:`, e);
        }
    }
    activeReportCrons.clear();

    let subs: ReportSubscription[] = [];
    try {
        subs = getAllReportSubscriptions();
    } catch (err: any) {
        console.error("Failed to load report subscriptions from database:", err.message);
        return;
    }

    for (const sub of subs) {
        try {
            if (!cron.validate(sub.cron_expression)) {
                console.warn(`⚠️ Invalid cron expression for subscription ID ${sub.id}: '${sub.cron_expression}'`);
                continue;
            }

            const task = cron.schedule(sub.cron_expression, async () => {
                console.log(`⏰ Executing scheduled report ID ${sub.id} (type: ${sub.report_type}) for user ${sub.user_id}`);
                if (sub.report_type === "summary") {
                    await sendSummaryReport(sub.user_id, sub.days);
                }
            }, {
                timezone: tz
            });

            activeReportCrons.set(sub.id, task);
        } catch (err: any) {
            console.error(`Failed to schedule report subscription ID ${sub.id}:`, err.message);
        }
    }

    console.log(`✅ Loaded and scheduled ${activeReportCrons.size} report subscriptions.`);
}


function startStorageAlertCron() {
    const tz = getTimezone();
    console.log(`⏰ Starting daily storage alert cron with timezone: ${tz}`);
    cron.schedule("0 10 * * *", async () => {
        const adminIds = getAllowedUserIdSet();
        if (adminIds.size === 0) return;

        try {
            const radarrFolders = await radarr.getRootFolders().catch(() => []);
            const sonarrFolders = await sonarr.getRootFolders().catch(() => []);

            const lowSpaceFolders: Array<{ service: string; path: string; freeSpace: string }> = [];
            const thresholdBytes = 50 * 1024 * 1024 * 1024; // 50 GB

            radarrFolders.forEach(f => {
                if (f.freeSpace < thresholdBytes) {
                    lowSpaceFolders.push({ service: "Radarr", path: f.path, freeSpace: formatBytes(f.freeSpace) });
                }
            });

            sonarrFolders.forEach(f => {
                if (f.freeSpace < thresholdBytes) {
                    lowSpaceFolders.push({ service: "Sonarr", path: f.path, freeSpace: formatBytes(f.freeSpace) });
                }
            });

            if (lowSpaceFolders.length > 0) {
                let alertMessage = `⚠️ *Low Storage Warning!*\n\nThe following folders have less than 50 GB free:\n\n`;
                lowSpaceFolders.forEach(f => {
                    alertMessage += `▫️ *[${f.service}]* \`${f.path}\`: *${f.freeSpace}* free\n`;
                });

                for (const adminId of adminIds) {
                    try {
                        await bot.api.sendMessage(adminId, alertMessage, { parse_mode: "Markdown" });
                    } catch (err) {
                        console.error(`Failed to send storage alert to ${adminId}:`, err);
                    }
                }
            }
        } catch (error) {
            console.error("Failed running storage alert cron:", error);
        }
    }, {
        timezone: tz
    });
}

// Audit specs and verify config on every run (non-fatal on startup to allow healchecks to pass)
await verifyConfig(false);

// Check for multiple instances matching this script
try {
    const scriptPath = resolve(projectRoot, "src/bot.ts");
    const proc = Bun.spawnSync({
        cmd: ["pgrep", "-f", `bun run ${scriptPath}`],
    });
    const pids = proc.stdout.toString().split("\n").filter(Boolean);
    if (pids.length > 1) {
        console.warn(`⚠️ Warning: Detected ${pids.length} instances of this bot script running. This may cause 409 Conflict errors.`);
        console.warn(`PIDs: ${pids.join(", ")}`);
    }
} catch (err) {
    // Ignore pgrep failures
}

// Instance locking MUST happen before starting any servers to prevent 409 conflicts
// and ensure only one service instance is active.
if (!acquireInstanceLock()) {
    const activePid = getMetadata("active_instance_pid");
    console.error(`❌ [${INSTANCE_ID}] Another instance (PID ${activePid}) is already active. Exiting to prevent 409 Conflict.`);
    // Wait a bit to avoid rapid restart loops in some environments
    await new Promise(resolve => setTimeout(resolve, 5000));
    process.exit(1);
}
startHeartbeat();
setupSignalHandlers();
setupConflictHandling();

// Initialize HTTP Server for Healthchecks and Webhooks
Bun.serve({
    port: Number(process.env.WEBHOOK_PORT) || 3000,
    async fetch(req) {
        const url = new URL(req.url);

        // Health check endpoint for Docker/Coolify
        if (req.method === "GET" && url.pathname === "/health") {
            return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        if (req.method === "POST") {
            if (url.pathname === "/plex-webhook" && process.env.USE_PLEX_WEBHOOK === "true") {
                return handlePlexWebhook(req, bot);
            }
            if (url.pathname === "/radarr-webhook") {
                return handleRadarrWebhook(req, bot);
            }
            if (url.pathname === "/sonarr-webhook") {
                return handleSonarrWebhook(req, bot);
            }
            if (url.pathname === "/nzbget-webhook") {
                return handleNZBGetWebhook(req, bot);
            }
        }
        return new Response("Not Found", { status: 404 });
    },
});

console.log(`📡 Health/Webhook server listening on port ${process.env.WEBHOOK_PORT || 3000}.`);

bot.api.getMe().then(async (me) => {
    console.log(`✅ Bot is online and listening as @${me.username}`);

    // Start the cron scheduler
    startWeeklySummaryCron();
    startStorageAlertCron();
    reloadReportSubscriptions();

    registerSubscriptionChangedCallback(() => {
        reloadReportSubscriptions();
    });

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
    let results = await checkAllServices();

    // If Sonarr is down, try to restart it (only on startup)
    const sonarrStatus = results.find(s => s.service === "Sonarr");
    if (sonarrStatus && !sonarrStatus.online) {
        console.warn("⚠️ Sonarr is offline at startup. Attempting auto-restart...");
        await sonarr.restartSonarrService();
        // Wait a bit for it to start up before checking again
        await new Promise(resolve => setTimeout(resolve, 5000));
        results = await checkAllServices();
    }

    results.forEach(s => {
        const icon = s.online ? "✅" : "❌";
        console.log(`${icon} ${s.service}: ${s.message}`);
    });

    // Changelog / Restart notification logic
    const adminIds = process.env.ALLOWED_USER_IDS?.split(",") || [];

    if (adminIds.length > 0) {
        try {
            const latestRelease = await getLatestChangelogRelease();
            const lastSentVersion = getMetadata("last_sent_changelog_version") || "";

            if (isNewerVersion(latestRelease.version, lastSentVersion)) {
                const startupTitle = "🔄 Bot startup changelog";
                const startupText = `${startupTitle}\n${buildReleaseChangelogText(latestRelease)}`;

                // Retrieve any admin IDs that failed in a previous startup attempt
                // so we can retry them even if the version was already committed.
                const previouslyFailedIds = new Set(
                    (getMetadata("changelog_failed_admin_ids") || "")
                        .split(",")
                        .filter(Boolean)
                );

                const failedIds: string[] = [];
                for (const adminId of adminIds) {
                    try {
                        const chunks = splitTelegramMessage(startupText);
                        for (const chunk of chunks) {
                            await bot.api.sendMessage(adminId, chunk);
                        }
                        // Successfully delivered — remove from failed set if it was there
                        previouslyFailedIds.delete(adminId);
                    } catch (err) {
                        console.error(`Failed to send startup message to ${adminId}:`, err);
                        failedIds.push(adminId);
                    }
                }

                // Persist the version only after at least one admin received the message.
                const anySucceeded = failedIds.length < adminIds.length;
                if (anySucceeded) {
                    setMetadata("last_sent_changelog_version", latestRelease.version);
                }

                // Store IDs that still need delivery so next startup can retry them.
                if (failedIds.length > 0) {
                    setMetadata("changelog_failed_admin_ids", failedIds.join(","));
                } else {
                    setMetadata("changelog_failed_admin_ids", "");
                }
            } else {
                // Even if the version hasn't changed, retry previously failed admins.
                const pendingIds = (getMetadata("changelog_failed_admin_ids") || "")
                    .split(",")
                    .filter(Boolean);

                if (pendingIds.length > 0) {
                    const latestText = `🔄 Bot startup changelog (retry)\n${buildReleaseChangelogText(latestRelease)}`;
                    const stillFailing: string[] = [];
                    for (const adminId of pendingIds) {
                        try {
                            const chunks = splitTelegramMessage(latestText);
                            for (const chunk of chunks) {
                                await bot.api.sendMessage(adminId, chunk);
                            }
                        } catch (err) {
                            console.error(`Retry: Failed to send startup message to ${adminId}:`, err);
                            stillFailing.push(adminId);
                        }
                    }
                    setMetadata("changelog_failed_admin_ids", stillFailing.join(","));
                }
            }
        } catch (err: any) {
            console.warn(`⚠️ Could not process changelog for startup notification: ${err.message}`);
        }
    }

    // Catch-up logic for unreplied messages
    // Sync watchlist on startup
    try {
        console.log("🔄 Synchronizing watchlist from Plex...");
        const syncResult = await plex.syncWatchlist();
        console.log(`✅ Watchlist synchronized: added ${syncResult.added}, removed ${syncResult.removed}`);
    } catch (err: any) {
        console.warn(`⚠️ Watchlist synchronization failed on startup: ${err.message}`);
    }

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
    console.log("🚀 Bot is ready and polling.");
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
                        await sendPhotoSmart(bot, userId, imageUrl, { caption: text, parse_mode: "Markdown" });
                    } else {
                        await bot.api.sendMessage(userId, text, { parse_mode: "Markdown" });
                    }
                } catch (e) {
                    if (imageUrl) {
                        await sendPhotoSmart(bot, userId, imageUrl, { caption: text });
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

