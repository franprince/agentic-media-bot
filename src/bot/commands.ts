import type { Bot } from "grammy";
import { formatBytes } from "../agent/tools/formatters.ts";
import {
	areNotificationsEnabled,
	formatEventTimestamp,
	getLocalWatchlist,
	getMetadata,
	getRecentMediaEvents,
	getUserName,
	setEventAlertConfig,
	setMetadata,
	setNotificationsEnabled,
} from "../services/database.ts";
import { checkAllServices } from "../services/health";
import * as plex from "../services/plex";
import * as radarr from "../services/radarr";
import * as sonarr from "../services/sonarr";
import { getAllowedUserIdSet } from "./auth.ts";
import { splitTelegramMessage, triggerExternalRestart } from "./utils.ts";

export function registerCommands(
	bot: Bot<any, any>,
	projectRoot: string,
	waitingForName: Map<number, { waitingForName: true }>,
	getBotRunner: () => any,
) {
	// Handle incoming /start command
	bot.command("start", async (ctx) => {
		if (!ctx.from) return;

		const userId = ctx.from.id;
		const existingName = getUserName(userId);

		if (existingName) {
			await ctx.reply(
				`👋 Welcome back, *${existingName}*! I am your *Agentic Media Bot*.

I help you manage your media library across:
✅ *Radarr* (Movies)
✅ *Sonarr* (TV Shows)
✅ *Plex* (Streaming)
✅ *qBittorrent* (Downloads)

How can I help you today?
/status - Check service health`,
				{ parse_mode: "Markdown" },
			);
			return;
		}

		// First time user, ask for their name
		waitingForName.set(userId, { waitingForName: true });
		await ctx.reply(
			`👋 Hello! I am your *Agentic Media Bot*.
    
    I help you manage your media library across:
    ✅ *Radarr* (Movies)
    ✅ *Sonarr* (TV Shows)
    ✅ *Plex* (Streaming)
    ✅ *qBittorrent* (Downloads)

    _If you haven't configured the bot yet, please run \`bun src/setup.ts\` on your server._

    What should I call you?`,
			{ parse_mode: "Markdown" },
		);
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

		const message = results
			.map((s) => {
				const icon = s.online ? "✅" : "❌";
				return `${icon} *${s.service}*: ${s.message}`;
			})
			.join("\n");

		await ctx.reply(`📡 *Service Status Report*\n\n${message}`, {
			parse_mode: "Markdown",
		});
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
			await ctx.reply(
				"You are not authorized to change notification settings.",
			);
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
			await ctx.reply(
				`Plex notifications are currently *${enabled ? "enabled" : "disabled"}*.\n\nUse \`/notifications on\` or \`/notifications off\` to change.`,
				{ parse_mode: "Markdown" },
			);
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
				await ctx.reply(`✅ Radarr *${eventType}* alerts turned *${state}*.`, {
					parse_mode: "Markdown",
				});
				return;
			} else {
				await ctx.reply("Usage: `/radarr alerts <grab|download> <on|off>`", {
					parse_mode: "Markdown",
				});
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
				await ctx.reply(`✅ Sonarr *${eventType}* alerts turned *${state}*.`, {
					parse_mode: "Markdown",
				});
				return;
			} else {
				await ctx.reply(
					"Usage: `/sonarr alerts <grab|download|seriesadd> <on|off>`",
					{ parse_mode: "Markdown" },
				);
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

			if (!eventType) {
				await ctx.reply(
					"Usage: `/plex alerts <play|resume|scrobble|library> <on|off>`",
					{ parse_mode: "Markdown" },
				);
				return;
			}

			const eventMapping: Record<string, string> = {
				play: "media.play",
				resume: "media.resume",
				scrobble: "media.scrobble",
				library: "library.new",
			};

			const actualEvent = eventMapping[eventType] || eventType;

			if (
				(actualEvent === "media.play" ||
					actualEvent === "media.resume" ||
					actualEvent === "media.scrobble" ||
					actualEvent === "library.new") &&
				(state === "on" || state === "off")
			) {
				const enabled = state === "on";
				setEventAlertConfig("plex", actualEvent, enabled);
				await ctx.reply(`✅ Plex *${eventType}* alerts turned *${state}*.`, {
					parse_mode: "Markdown",
				});
				return;
			} else {
				await ctx.reply(
					"Usage: `/plex alerts <play|resume|scrobble|library> <on|off>`",
					{ parse_mode: "Markdown" },
				);
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
				const runner = getBotRunner();
				runner?.stop();
			} catch (stopError) {
				console.error("Failed to stop bot runner before restart:", stopError);
			}

			const spawned = triggerExternalRestart(projectRoot);
			if (spawned) {
				process.exit(0);
				return;
			}

			try {
				const runner = getBotRunner();
				runner?.stop();
				// We cannot re-initialize Grammy runner here without reference to run(),
				// but the runner stop/start in-process logic can be orchestrated by main bot.ts.
				// We will let the main process handle the actual fallback or restart if needed.
				console.log(
					"⚠️ Standalone restart fallback executed (requires full process restart).",
				);
			} catch (fallbackError) {
				console.error(
					"Failed to restart bot runner via fallback:",
					fallbackError,
				);
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

				const hasError =
					text.toLowerCase().includes("error") ||
					text.toLowerCase().includes("typeerror") ||
					text.toLowerCase().includes("conflict");

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
					await ctx.reply(
						"🛠️ *Repair required?* You can ask Antigravity (Assistant) to review these logs and apply a fix.",
					);
				}
			} else {
				await ctx.reply(
					"❌ Log file not found at /tmp/agentic-media-bot-restart.log",
				);
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
			await plex.syncWatchlist();
			const watchlist = getLocalWatchlist();

			if (watchlist.length === 0) {
				await ctx.reply("Your watchlist is currently empty.");
				return;
			}

			let report = `🍿 *Your Watchlist*\n\n`;
			watchlist.forEach((item, index) => {
				const typeIcon = item.media_type === "movie" ? "🎬" : "📺";
				const statusIcon =
					item.status === "completed"
						? "✅"
						: item.status === "downloading"
							? "⏳"
							: "▫️";
				report += `${index + 1}. ${typeIcon} *${item.title}* (${item.media_type})\n   Status: \`${item.status}\` ${statusIcon}\n\n`;
			});

			const chunks = splitTelegramMessage(report);
			for (const chunk of chunks) {
				await ctx.reply(chunk, { parse_mode: "Markdown" });
			}
		} catch (error: any) {
			console.error("Failed to list watchlist:", error);
			await ctx.reply(
				`❌ Failed to retrieve watchlist: ${error.message || "Unknown error"}`,
			);
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

		const statusMsg = await ctx.reply(
			"🔄 *Synchronizing watchlist with Plex Discover...*",
			{ parse_mode: "Markdown" },
		);

		try {
			const syncResult = await plex.syncWatchlist();
			await ctx.api.editMessageText(
				ctx.chat.id,
				statusMsg.message_id,
				`✅ *Watchlist synchronization complete!*\n\nAdded: *${syncResult.added}* new item(s)\nRemoved: *${syncResult.removed}* item(s) no longer in Plex Watchlist.`,
				{ parse_mode: "Markdown" },
			);
		} catch (error: any) {
			console.error("Failed to sync watchlist:", error);
			try {
				await ctx.api.editMessageText(
					ctx.chat.id,
					statusMsg.message_id,
					`❌ *Watchlist synchronization failed:*\n${error.message || "Unknown error"}`,
					{ parse_mode: "Markdown" },
				);
			} catch (_) {
				await ctx.reply(
					`❌ Failed to sync watchlist: ${error.message || "Unknown error"}`,
				);
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

		await ctx.reply("💾 *Checking storage usage...*", {
			parse_mode: "Markdown",
		});

		try {
			const radarrFolders = await radarr.getRootFolders().catch(() => []);
			const sonarrFolders = await sonarr.getRootFolders().catch(() => []);

			let report = `💾 *Storage Information*\n\n`;

			if (radarrFolders.length > 0) {
				report += `🎬 *Radarr:*\n`;
				radarrFolders.forEach((f) => {
					report += `▫️ \`${f.path}\`: *${formatBytes(f.freeSpace)}* free\n`;
				});
				report += `\n`;
			}

			if (sonarrFolders.length > 0) {
				report += `📺 *Sonarr:*\n`;
				sonarrFolders.forEach((f) => {
					report += `▫️ \`${f.path}\`: *${formatBytes(f.freeSpace)}* free\n`;
				});
			}

			if (radarrFolders.length === 0 && sonarrFolders.length === 0) {
				report = `❌ Could not retrieve storage folders from Radarr or Sonarr.`;
			}

			await ctx.reply(report, { parse_mode: "Markdown" });
		} catch (error: any) {
			console.error("Failed to check storage:", error);
			await ctx.reply(
				`❌ Failed to retrieve storage info: ${error.message || "Unknown error"}`,
			);
		}
	});
}
