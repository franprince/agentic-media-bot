import { isAbsolute, resolve } from "node:path";
import { run } from "@grammyjs/runner";
import { Bot } from "grammy";
import {
	buildReleaseChangelogText,
	getLatestChangelogRelease,
	isNewerVersion,
} from "./bot/changelog.ts";
import { registerCommands } from "./bot/commands.ts";
import { registerCrons } from "./bot/crons.ts";
import {
	acquireInstanceLock,
	INSTANCE_ID,
	setupConflictHandling,
	setupSignalHandlers,
	startHeartbeat,
} from "./bot/instance.ts";
import {
	extractUserTextFromHistoryMessage,
	getLocalizedCatchupStatus,
	handleUserText,
	registerMessageHandlers,
	sendPhotoSmart,
} from "./bot/messages.ts";
import { splitTelegramMessage } from "./bot/utils.ts";
import {
	getAllConversations,
	getMetadata,
	setMetadata,
} from "./services/database.ts";
import { checkAllServices } from "./services/health";
import * as plex from "./services/plex";
import * as sonarr from "./services/sonarr";
import {
	handleNZBGetWebhook,
	handlePlexWebhook,
	handleRadarrWebhook,
	handleSonarrWebhook,
} from "./services/webhooks.ts";
import { verifyConfig } from "./verify-config";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
	throw new Error("TELEGRAM_BOT_TOKEN environment variable is not set.");
}

const bot = new Bot(token);
let botRunner: ReturnType<typeof run> | undefined;
const projectRoot = resolve(import.meta.dir, "..");

// Conversation state for name collection
const waitingForName = new Map<number, { waitingForName: true }>();

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
		console.warn(
			`⚠️ Warning: Detected ${pids.length} instances of this bot script running. This may cause 409 Conflict errors.`,
		);
		console.warn(`PIDs: ${pids.join(", ")}`);
	}
} catch (err) {
	// Ignore pgrep failures
}

// Initialize HTTP Server for Healthchecks and Webhooks immediately on startup
Bun.serve({
	port: Number(process.env.WEBHOOK_PORT) || 3000,
	async fetch(req) {
		const url = new URL(req.url);

		// Health check endpoint for Docker/Coolify
		if (req.method === "GET" && url.pathname === "/health") {
			return new Response(
				JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		if (req.method === "POST") {
			if (
				url.pathname === "/plex-webhook" &&
				process.env.USE_PLEX_WEBHOOK === "true"
			) {
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

console.log(
	`📡 Health/Webhook server listening on port ${process.env.WEBHOOK_PORT || 3000}.`,
);

// Start background loop to acquire the instance lock before starting the bot runner
async function startBotLifecycle() {
	let hasLock = false;
	while (!hasLock) {
		if (acquireInstanceLock()) {
			hasLock = true;
			break;
		}
		const activePid = getMetadata("active_instance_pid");
		const activeId = getMetadata("active_instance_id");
		console.log(
			`⏳ [${INSTANCE_ID}] Another instance (PID ${activePid}, ID ${activeId}) is active. Waiting to acquire lock...`,
		);
		await new Promise((resolve) => setTimeout(resolve, 10000)); // check every 10 seconds
	}

	console.log(
		`✅ [${INSTANCE_ID}] Instance lock acquired! Starting bot lifecycle.`,
	);
	startHeartbeat();
	setupSignalHandlers();
	setupConflictHandling(bot);

	bot.api.getMe().then(async (me) => {
		console.log(`✅ Bot is online and listening as @${me.username}`);

		// Register submodules
		registerCommands(bot, projectRoot, waitingForName, () => botRunner);
		registerMessageHandlers(bot, token, waitingForName);
		registerCrons(bot);

		// Notify startup
		const restartNotifyChatId = Number(getMetadata("restart_notify_chat_id"));
		if (Number.isFinite(restartNotifyChatId) && restartNotifyChatId > 0) {
			const restartNotifyLang = getMetadata("restart_notify_lang");
			const message =
				restartNotifyLang === "es"
					? "✅ Volví a estar en línea."
					: "✅ I am back online.";
			try {
				await bot.api.sendMessage(restartNotifyChatId, message);
			} catch (error) {
				console.error(
					`Failed to send restart notification to ${restartNotifyChatId}:`,
					error,
				);
			} finally {
				setMetadata("restart_notify_chat_id", "");
				setMetadata("restart_notify_lang", "");
			}
		}

		// Initial health check
		console.log("📡 performing initial service health check...");
		let results = await checkAllServices();

		// If Sonarr is down, try to restart it (only on startup)
		const sonarrStatus = results.find((s) => s.service === "Sonarr");
		if (sonarrStatus && !sonarrStatus.online) {
			console.warn(
				"⚠️ Sonarr is offline at startup. Attempting auto-restart...",
			);
			await sonarr.restartSonarrService();
			// Wait a bit for it to start up before checking again
			await new Promise((resolve) => setTimeout(resolve, 5000));
			results = await checkAllServices();
		}

		results.forEach((s) => {
			const icon = s.online ? "✅" : "❌";
			console.log(`${icon} ${s.service}: ${s.message}`);
		});

		// Changelog / Restart notification logic
		const adminIds = process.env.ALLOWED_USER_IDS?.split(",") || [];

		if (adminIds.length > 0) {
			try {
				const latestRelease = await getLatestChangelogRelease(projectRoot);
				const lastSentVersion =
					getMetadata("last_sent_changelog_version") || "";

				if (isNewerVersion(latestRelease.version, lastSentVersion)) {
					const startupTitle = "🔄 Bot startup changelog";
					const startupText = `${startupTitle}\n${buildReleaseChangelogText(latestRelease)}`;

					// Retrieve any admin IDs that failed in a previous startup attempt
					// so we can retry them even if the version was already committed.
					const previouslyFailedIds = new Set(
						(getMetadata("changelog_failed_admin_ids") || "")
							.split(",")
							.filter(Boolean),
					);

					const failedIds: string[] = [];
					for (const adminId of adminIds) {
						try {
							console.log(
								`📢 Sending changelog v${latestRelease.version} to admin ${adminId}...`,
							);
							const chunks = splitTelegramMessage(startupText);
							for (const chunk of chunks) {
								await bot.api.sendMessage(adminId, chunk);
							}
							console.log(`✅ Changelog sent to admin ${adminId}.`);
							// Successfully delivered — remove from failed set if it was there
							previouslyFailedIds.delete(adminId);
						} catch (err) {
							console.error(
								`Failed to send startup message to ${adminId}:`,
								err,
							);
							failedIds.push(adminId);
						}
					}

					// Persist the version only after at least one admin received the message.
					const anySucceeded = failedIds.length < adminIds.length;
					if (anySucceeded) {
						setMetadata("last_sent_changelog_version", latestRelease.version);
						console.log(
							`📝 Changelog version committed to DB: ${latestRelease.version}`,
						);
					}

					// Store IDs that still need delivery so next startup can retry them.
					if (failedIds.length > 0) {
						setMetadata("changelog_failed_admin_ids", failedIds.join(","));
						console.warn(
							`⚠️ Changelog delivery failed for admin IDs: ${failedIds.join(", ")}. Will retry on next startup.`,
						);
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
								console.error(
									`Retry: Failed to send startup message to ${adminId}:`,
									err,
								);
								stillFailing.push(adminId);
							}
						}
						setMetadata("changelog_failed_admin_ids", stillFailing.join(","));
					}
				}
			} catch (err: any) {
				console.warn(
					`⚠️ Could not process changelog for startup notification: ${err.message}`,
				);
			}
		}

		// Catch-up logic for unreplied messages
		// Sync watchlist on startup
		try {
			console.log("🔄 Synchronizing watchlist from Plex...");
			const syncResult = await plex.syncWatchlist();
			console.log(
				`✅ Watchlist synchronized: added ${syncResult.added}, removed ${syncResult.removed}`,
			);
		} catch (err: any) {
			console.warn(
				`⚠️ Watchlist synchronization failed on startup: ${err.message}`,
			);
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
}

startBotLifecycle();

async function syncUnrepliedMessages() {
	const conversations = getAllConversations();
	for (const conv of conversations) {
		const history = conv.history;
		const lastMessage = history[history.length - 1];

		// If the last message is from a user, we haven't replied yet
		if (lastMessage && lastMessage.role === "user") {
			const userId = Number(conv.userId);
			console.log(
				`⏳ Found unreplied message from ${userId}, processing retroactive response...`,
			);

			try {
				// Send a notification that we're catching up
				const lastUserText = extractUserTextFromHistoryMessage(lastMessage);
				const statusMsg = await bot.api.sendMessage(
					userId,
					getLocalizedCatchupStatus(lastUserText),
					{ parse_mode: "Markdown" },
				);

				const onStep = async (status: string) => {
					try {
						await bot.api.editMessageText(
							userId,
							statusMsg.message_id,
							status,
							{ parse_mode: "Markdown" },
						);
					} catch (err) {
						// Ignore
					}
				};

				// Process the message (passing undefined for userMessage since it's already in history)
				const { text, imageUrl } = await processUserMessage(
					userId,
					undefined,
					onStep,
				);

				// Clean up status message
				try {
					await bot.api.deleteMessage(userId, statusMsg.message_id);
				} catch (err) {
					// Ignore
				}

				// Use the safeReply-like logic directly for the catch-up phase
				try {
					if (imageUrl) {
						await sendPhotoSmart(bot, userId, imageUrl, {
							caption: text,
							parse_mode: "Markdown",
						});
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
