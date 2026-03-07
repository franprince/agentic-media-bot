import { Bot, InlineKeyboard, InputFile } from "grammy";
import { run } from "@grammyjs/runner";
import { resolve, isAbsolute } from "node:path";
import { processUserMessage } from "./agent/index.ts";
import { detectStatusLanguage } from "./agent/status.ts";
import { getMetadata, setMetadata, getAllConversations, getUserName, setUserName, areNotificationsEnabled, setNotificationsEnabled, getRecentMediaEvents, setEventAlertConfig } from "./services/database.ts";
import cron from "node-cron";
import { verifyConfig } from "./verify-config";
import { checkAllServices } from "./services/health";
import { handlePlexWebhook, handleRadarrWebhook, handleSonarrWebhook } from "./services/webhooks.ts";
import * as sonarr from "./services/sonarr";

// Setup telegram bot using the token from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is not set.");
}

const bot = new Bot(token);
let botRunner: ReturnType<typeof run> | undefined;
const projectRoot = resolve(import.meta.dir, "..");
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT) || 3000;

// Conversation state for name collection
type WaitingForNameState = { waitingForName: true };
const waitingForName = new Map<number, WaitingForNameState>();

type ChangelogRelease = {
    version: string;
    changes: string[];
};

const CHANGELOG_RELEASES: ChangelogRelease[] = [
    {
        version: "4.0.0",
        changes: [
            "feat: Added Plex search by duration - find movies shorter than, longer than, or between specific durations.",
            "feat: Added multilingual Plex search fallback via Radarr/Sonarr for better international title matching.",
            "fix: Fixed Plex country search limit parameter to be nullable.",
            "chore: Updated agent system prompt to include new duration-based search capabilities.",
        ],
    },
    {
        version: "4.0.1",
        changes: [
            "fix: Add limit parameter extraction to searchPlexByDuration tool",
            "fix(plex): Fix getPlexLibraryStats to return all items for filtering",
            "docs: Clarify that country names must always be in English for tool calls",
            "docs: Add movie details format and remove copyright disclaimer from system prompt",
            "feat: Add getPosterData for fetching poster as base64 data URL",
            "fix: Add undefined check in mapWithConcurrency worker",
            "fix: Revert mapWithConcurrency return type to Promise<R[]>",
            "fix: Correct Plex duration search to fetch all movies with pagination",
            "fix: Improve repair prompt with explicit type rules for number parameters",
            "fix: Correct searchPlexByDuration tool signature in system prompt",
        ],
    },
    {
        version: "4.1.0",
        changes: [
            "refactor: Centralized API fetch logic in src/services/api.ts for Radarr, Sonarr, and Plex.",
            "refactor: Modularized agent core logic into separate src/agent/prompts.ts and src/agent/utils.ts files.",
            "fix: Standardized error reporting for service API calls with detailed error messages.",
            "test: Added comprehensive unit tests for the architectural refactor.",
        ],
    },
    {
        version: "4.2.0",
        changes: [
            "feat: Migrated complete testing suite to Mock Service Worker (MSW).",
            "refactor: Replaced manual fetch mocks in Sonarr, Radarr, Plex, and qBittorrent tests with centralized MSW handlers.",
            "test: Improved test reliability and network interception accuracy.",
        ],
    },
    {
        version: "4.2.1",
        changes: [
            "fix: Suppressed redundant changelog notifications on every restart.",
            "fix: Optimized Spanish language detection for short user phrases.",
            "fix: Removed redundant saveUserName tool to prevent LLM-based name hallucinations.",
            "feat: Added strict rules to prevent mixing movies and series in recommendations.",
        ],
    },
    {
        version: "4.3.0",
        changes: [
            "feat: Added interactive CLI setup tool (src/setup.ts) for easy onboarding.",
            "feat: Added automated dependency installation in the setup tool.",
            "feat: Added automated Plex section discovery during setup.",
            "docs: Updated README and created .env.example template.",
            "refactor: Improved configuration verification logic to guide new users.",
        ],
    },
    {
        version: "4.3.1",
        changes: [
            "fix: Resolved tool-calling crash caused by dead reference to removed saveUserNameTool.",
            "test: Added tool integrity test suite to prevent future mapping regressions.",
        ],
    },
    {
        version: "4.4.0",
        changes: [
            "feat: Standardized Plex search tool names to searchPlexByCountry, searchPlexByGenre, and searchPlexByDuration.",
            "refactor: Updated system prompt and specifications to reflect standardized tool names.",
            "feat: Improved history migration to automatically normalize legacy tool names to the new standard.",
            "chore: Kept legacy tool names as aliases for backward compatibility.",
        ],
    },
    {
        version: "4.5.0",
        changes: [
            "fix: Improved Plex browsing to search across both movie and show libraries concurrently.",
            "fix: Resolved issue where TV shows like 'The Bear' were not found during genre/country discovery.",
            "refactor: Replaced hardcoded recommendations in discoverMediaTool with dynamic discovery logic.",
            "docs: Clarified that duration searches are movie-specific.",
        ],
    },
    {
        version: "4.6.0",
        changes: [
            "feat: Integrated Plex webhooks for real-time notifications.",
            "feat: Added automated notifications for new media and playback activity.",
            "feat: Embedded lightweight web server using Bun.serve to handle webhook callbacks.",
            "test: Added unit test suite for webhook payload parsing and notification formatting.",
        ],
    },
    {
        version: "4.7.0",
        changes: [
            "feat: Added /notifications <on/off> command to toggle Plex alerts.",
            "feat: Persisted notification preferences in the database.",
            "fix: Webhook service now respects user notification settings.",
            "test: Added test case for skipped notifications in webhook service.",
        ],
    },
    {
        version: "4.8.0",
        changes: [
            "feat: Added optional Plex webhook setup in the CLI tool.",
            "feat: Webhook server now only starts if explicitly enabled via USE_PLEX_WEBHOOK.",
            "refactor: Updated configuration verification to handle disabled webhook status correctly.",
        ],
    },
    {
        version: "4.9.0",
        changes: [
            "feat: Added /audit command for admin-only log diagnostics and error reporting.",
            "fix: Added defensive tool filtering to prevent 'undefined' tool crashes in the AI SDK.",
            "fix: Improved process termination logic in restart supervisor to prevent 409 Conflict errors.",
            "feat: Added startup instance detection to warn about multiple running bot processes.",
        ],
    },
    {
        version: "4.9.1",
        changes: [
            "feat: Added originalTitle field to PlexWebhookPayload.Metadata interface.",
            "feat: Implemented isNonLatinTitle helper to detect non-Latin script titles (Japanese, Korean, Chinese, Arabic, etc.).",
            "feat: Implemented withEnglishTitle helper to append English/original title in parentheses per Title Localization Protocol.",
            "fix: Webhook notifications for library.new, media.play, and media.scrobble events now display English/original title alongside non-Latin titles.",
            "test: Added 19 new tests covering isNonLatinTitle, withEnglishTitle, and webhook integration for foreign-language titles.",
        ],
    },
    {
        version: "4.9.2",
        changes: [
            "fix: Resolved tool integrity test mismatch by updating test to match current tool mapping with legacy aliases.",
            "fix: Added timeout and retry logic to webhook image fetching to prevent hanging requests (10s timeout, 3 retries with exponential backoff).",
            "fix: Enhanced process detection with more specific patterns and PID validation to prevent false positives.",
            "feat: Implemented LRU cache management with 100-entry limit and automatic cleanup to prevent memory leaks.",
            "feat: Added SQL input sanitization to prevent prototype pollution attacks in conversation history.",
            "feat: Implemented cache invalidation on webhook library.new events to ensure fresh data.",
            "feat: Added structured logging for webhook error scenarios with detailed diagnostic information.",
            "refactor: Enhanced type safety by replacing 'any' types with proper TypeScript interfaces.",
            "refactor: Standardized error handling patterns across all services with centralized error utilities.",
            "test: Updated test expectations to match new standardized error message format.",
        ],
    },
    {
        version: "4.10.0",
        changes: [
            "feat: Implemented smart playback notifications for Plex webhooks.",
            "feat: Added session state tracking in the database to filter out routine unpauses.",
            "feat: Added notification for 'media.resume' only when not preceded by a pause (significant resume).",
            "fix: Reduced notification noise by ignoring 'media.pause' events while maintaining session state.",
        ],
    },
    {
        version: "4.11.0",
        changes: [
            "feat: Improved search intelligence by guiding LLM to use specialized country-of-origin tools.",
            "fix: Enhanced Spanish language detection signals with word-boundary checks to prevent false positives.",
            "fix: Removed ambiguous 'series' and 'serie' keywords from language signals to improve accuracy.",
            "test: Added E2E regression test suite for origin search and language consistency.",
        ],
    },
    {
        version: "4.12.0",
        changes: [
            "feat: Customized Plex webhook notification templates for movies and series.",
            "feat: Implemented SxxExx format for series notifications.",
            "refactor: Generalized title localization to show original title whenever it differs from the displayed title.",
            "test: Added comprehensive test suite for new notification formats and localization logic.",
        ],
    },
    {
        version: "4.13.0",
        changes: [
            "feat: Implemented Cross-Service Alias Recovery for webhook notifications.",
            "feat: Enhanced metadata enrichment to fallback to Radarr/Sonarr for foreign titles.",
            "fix: Cleaned up notification format by removing colons and newlines for better readability.",
            "fix: Improved metadata enrichment reliability for movies missing original titles in Plex.",
        ],
    },
    {
        version: "4.14.0",
        changes: [
            "feat: Added 'Launch on Startup' option in the setup script for Linux (systemd).",
            "feat: Implemented IMDb ID prioritization and title validation for movie and series additions.",
            "fix: Resolved strict TypeScript 'possibly undefined' error in Plex webhook service.",
            "test: Added unit tests for IMDb validation and regression tests for webhook show enrichment.",
        ],
    },
    {
        version: "4.15.0",
        changes: [
            "feat: Restricted Plex webhook notifications to watching activity only (play, resume, scrobble).",
            "chore: Library additions (library.new) no longer trigger Telegram alerts but still invalidate the internal cache.",
        ],
    },
    {
        version: "4.16.0",
        changes: [
            "feat: Added systemd user service management instructions to README.",
            "feat: Updated setup script with explicit service management commands.",
            "docs: Added 'Bot Logs' and 'How to Manage the Bot' sections to README.",
        ],
    },
    {
        version: "4.17.0",
        changes: [
            "feat: Implemented history trimming to prevent context 'stickiness'.",
            "feat: Added interactive selection of quality profiles and root folders for media additions.",
            "feat: Improved Anime support in Sonarr with automatic seriesType detection.",
            "fix: Standardized success messages for Radarr and Sonarr tools.",
            "test: Added unit tests for history management and Sonarr anime detection.",
        ],
    },
    {
        version: "4.18.0",
        changes: [
            "feat: Added support for cloud-hosted Ollama models via OLLAMA_BASE_URL env var.",
            "refactor: Transitioned to @ai-sdk/openai bridge for Ollama to support custom hosts and better endpoint flexibility.",
            "feat: Improved configuration verification with real AI generation tests for Ollama.",
            "fix: Resolved pre-existing bug in OpenRouter/OpenAI verification connectivity check.",
            "fix: Updated zod and zod-to-json-schema to resolve environment-specific module loading errors.",
        ],
    },
    {
        version: "4.19.0",
        changes: [
            "feat: Added NZBGet service integration.",
            "feat: Implemented NZBGet health check in /status command.",
        ],
    },
    {
        version: "4.20.0",
        changes: [
            "feat: Added media deletion support for both movies and TV shows.",
            "feat: Implemented removeMovieTool and removeSeriesTool for the agent.",
        ],
    },
    {
        version: "4.21.0",
        changes: [
            "feat: Added media type labeling ([Movie]/[Show]) to all search results.",
            "feat: Broadened country search to include co-productions (e.g., Japan/USA).",
            "feat: Improved library statistics to include all sections (including Anime) dynamically.",
        ],
    },
    {
        version: "4.21.1",
        changes: [
            "fix: Added mandatory interactive confirmation for media removal in Radarr and Sonarr.",
            "fix: Bot now explicitly asks whether to keep or delete media files during removals.",
            "fix: Resolved type definition missing fields for Radarr and Sonarr media objects.",
        ],
    },
    {
        version: "4.21.2",
        changes: [
            "feat: Added Telegram Inline Buttons for interactive confirmations and choices.",
            "fix: Streamlined message handling to properly route callback queries through the agent.",
        ],
    },
    {
        version: "4.22.0",
        changes: [
            "fix: Implemented database persistence in Coolify by migrating bot_data.sqlite to a dedicated data/ directory.",
            "feat: Added automated data/ directory provisioning on startup.",
            "docs: Updated technical specifications with persistent volume mapping requirements.",
        ],
    },
    {
        version: "4.23.0",
        changes: [
            "fix: Implemented a smart image handler that fetches local images from Plex/internal addresses.",
            "fix: Resolved 'Bad Request: wrong remote file identifier' errors when sending photos with localhost URLs.",
            "perf: Improved filename and extension detection for uploaded media.",
        ],
    },
    {
        version: "4.24.0",
        changes: [
            "feat: Enabled Plex library notifications for new movies and episodes.",
            "feat: Added comprehensive /help command listing all bot features and commands.",
            "test: Updated webhook test suite to verify library.new notifications.",
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
    const latest = CHANGELOG_RELEASES[CHANGELOG_RELEASES.length - 1];
    if (!latest) {
        throw new Error("No changelog releases defined");
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
🔔 /notifications <on/off> - Toggle Plex alerts
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
        const dateStr = new Date(ev.timestamp + "Z").toLocaleString();
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
        const dateStr = new Date(ev.timestamp + "Z").toLocaleString();
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

        if (req.method === "POST" && process.env.USE_PLEX_WEBHOOK === "true") {
            if (url.pathname === "/plex-webhook") {
                return handlePlexWebhook(req, bot);
            }
            if (url.pathname === "/radarr-webhook") {
                return handleRadarrWebhook(req, bot);
            }
            if (url.pathname === "/sonarr-webhook") {
                return handleSonarrWebhook(req, bot);
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
        const latestRelease = getLatestChangelogRelease();
        const lastSentVersion = getMetadata("last_sent_changelog_version");

        if (lastSentVersion !== latestRelease.version) {
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
