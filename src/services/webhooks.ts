import { areNotificationsEnabled, getPlaybackState, updatePlaybackState, saveMediaEvent, getEventAlertConfig, getPendingNotifications, markNotificationSent } from "./database";
import { getItemMetadata, getPosterUrl } from "./plex";
import { searchMovie } from "./radarr";
import { searchSeries } from "./sonarr";
import { clearCache } from "../agent/tools";
import { Bot, InputFile } from "grammy";
import type { RadarrWebhookPayload } from "../types/radarr";
import type { SonarrWebhookPayload } from "../types/sonarr";

export interface PlexWebhookPayload {
    event: string;
    user: boolean;
    owner: boolean;
    Account: {
        id: number;
        thumb: string;
        title: string;
    };
    Server: {
        title: string;
        uuid: string;
    };
    Player: {
        local: boolean;
        publicAddress: string;
        title: string;
        uuid: string;
    };
    Metadata: {
        librarySectionType: string;
        ratingKey: string;
        key: string;
        parentRatingKey?: string;
        grandparentRatingKey?: string;
        guid: string;
        librarySectionID: number;
        type: string;
        title: string;
        originalTitle?: string;
        grandparentKey?: string;
        parentKey?: string;
        grandparentTitle?: string;
        parentTitle?: string;
        summary: string;
        index?: number;
        parentIndex?: number;
        ratingCount?: number;
        thumb: string;
        art: string;
        parentThumb?: string;
        grandparentThumb?: string;
        grandparentArt?: string;
        addedAt: number;
        updatedAt: number;
        year?: number;
    };
}

export async function handlePlexWebhook(request: Request, bot: Bot) {
    try {
        const formData = await request.formData();
        const payloadStr = formData.get("payload") as string;
        if (!payloadStr) {
            return new Response("Missing payload", { status: 400 });
        }

        const payload: PlexWebhookPayload = JSON.parse(payloadStr);

        if (payload.Metadata && !payload.Metadata.originalTitle && payload.Metadata.ratingKey) {
            try {
                const fullMetadata = await getItemMetadata(payload.Metadata.ratingKey);
                if (fullMetadata?.originalTitle) {
                    payload.Metadata.originalTitle = fullMetadata.originalTitle;
                }
            } catch (err) {
                console.warn(`⚠️ Failed to enrich metadata from Plex API for ${payload.Metadata.ratingKey}:`, (err as Error).message);
            }
        }

        // Cross-Service Alias Recovery (Radarr/Sonarr fallback for non-Latin titles)
        if (payload.Metadata && !payload.Metadata.originalTitle && isNonLatinTitle(payload.Metadata.title)) {
            try {
                const metadata = payload.Metadata;
                if (metadata.librarySectionType === "movie") {
                    const results = await searchMovie(metadata.title);
                    // Try to match by year if available
                    const match = metadata.year
                        ? results.find((r: any) => r.year === metadata.year)
                        : results[0];

                    if (match && match.title !== metadata.title) {
                        payload.Metadata.originalTitle = match.title;
                    }
                } else if (metadata.librarySectionType === "show") {
                    const searchTerm = metadata.grandparentTitle || metadata.title;
                    const results = await searchSeries(searchTerm);
                    const firstMatch = results[0];
                    if (firstMatch && firstMatch.title !== metadata.title) {
                        const originalTitle = firstMatch.title;
                        if (payload.Metadata) {
                            payload.Metadata.originalTitle = originalTitle;
                        }
                    }
                }
            } catch (err) {
                console.warn(`⚠️ Cross-service enrichment failed for "${payload.Metadata?.title}":`, (err as Error).message);
            }
        }

        // Invalidate cache when library content changes
        if (payload.event === "library.new") {
            console.log("🗂️ Plex library updated, invalidating cache...");
            clearCache();
        }

        const sessionId = getSessionId(payload);
        const prevState = getPlaybackState(sessionId);

        // Update persistent state
        updatePlaybackState(sessionId, payload.event);

        const notifyChatId = process.env.WEBHOOK_NOTIFY_CHAT_ID || process.env.ALLOWED_USER_IDS?.split(",")[0];

        if (!notifyChatId) {
            console.warn("⚠️ No notification chat ID configured for webhooks.");
            return new Response("No notification target", { status: 200 });
        }

        const message = formatWebhookMessage(payload, prevState);

        if (message) {
            // Check if notifications are globally disabled or service-specific events are disabled
            if (!areNotificationsEnabled()) {
                console.log(`Plex Webhook: Notifications are disabled, skipping alert for ${payload.event}`);
            } else if (!getEventAlertConfig("plex", payload.event)) {
                console.log(`Plex Webhook: Notifications for event ${payload.event} are disabled in settings.`);
            } else {
                const PLEX_URL = process.env.PLEX_URL?.trim();
                const PLEX_TOKEN = process.env.PLEX_TOKEN?.trim();

                const thumb = payload.Metadata?.thumb || payload.Metadata?.parentThumb || payload.Metadata?.grandparentThumb;
                const thumbUrl = (thumb && PLEX_URL && PLEX_TOKEN) ? getPosterUrl(thumb) : undefined;

                try {
                    if (thumbUrl) {
                        let response: Response | null = null;
                        let lastError: Error | null = null;

                        for (let attempt = 1; attempt <= 3; attempt++) {
                            try {
                                const controller = new AbortController();
                                const timeoutId = setTimeout(() => controller.abort(), 10000);

                                response = await fetch(thumbUrl, {
                                    signal: controller.signal,
                                    headers: { 'User-Agent': 'agentic-media-bot/1.0' }
                                });

                                clearTimeout(timeoutId);

                                if (response.ok) {
                                    break;
                                } else {
                                    lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
                                }
                            } catch (err) {
                                lastError = err as Error;
                                console.warn(`Webhook image fetch attempt ${attempt} failed:`, lastError.message);
                            }

                            if (attempt < 3) {
                                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
                            }
                        }

                        if (response && response.ok) {
                            const buffer = await response.arrayBuffer();
                            const urlPart = thumbUrl!.split("?")[0];
                            const extension = urlPart!.split(".").pop() || "jpg";
                            const filename = `thumb.${extension}`;
                            await bot.api.sendPhoto(notifyChatId, new InputFile(Buffer.from(buffer), filename), {
                                caption: message,
                                parse_mode: "Markdown"
                            });
                        } else {
                            throw new Error(`Failed to fetch thumb after 3 attempts: ${lastError?.message || 'Unknown error'}`);
                        }
                    } else {
                        await bot.api.sendMessage(notifyChatId, message, { parse_mode: "Markdown" });
                    }
                } catch (err) {
                    const error = err as Error;
                    console.error("Failed to send webhook notification:", {
                        error: error.message,
                        stack: error.stack,
                        payload: {
                            event: payload.event,
                            title: payload.Metadata?.title,
                            type: payload.Metadata?.type,
                            user: payload.Account?.title
                        },
                        thumbUrl,
                        notifyChatId
                    });

                    try {
                        const plainTextMessage = message.replace(/[_*`]/g, "");
                        await bot.api.sendMessage(notifyChatId, plainTextMessage);
                        console.info("Successfully sent fallback plain text message");
                    } catch (fallbackErr) {
                        console.error("Failed to send fallback message:", (fallbackErr as Error).message);
                    }
                }
            }
        }

        // Always save plex events to DB
        let eventTitle = payload.Metadata?.title || payload.event;
        const dbMessage = message ? message.replace(/[_*`]/g, "") : `Plex Event: ${payload.event} - ${eventTitle}`;
        saveMediaEvent("plex", payload.event, eventTitle, dbMessage);

        return new Response("OK", { status: 200 });
    } catch (error) {
        const err = error as Error;
        console.error("Error processing Plex webhook:", err.message);
        return new Response("Internal Server Error", { status: 500 });
    }
}

export async function handleRadarrWebhook(request: Request, bot: Bot) {
    try {
        const payload = (await request.json()) as RadarrWebhookPayload;
        const { eventType, movie, release } = payload;

        if (eventType === "Test") {
            return new Response("OK", { status: 200 });
        }

        let message = "";
        let eventTitle = `${movie.title} (${movie.year})`;

        if (eventType === "Grab") {
            message = `📥 *Radarr*: Grabbed *${eventTitle}*\n\n`;
            message += `▫️ *Quality*: ${release.quality}\n`;
            if (release.releaseTitle) message += `▫️ *Release*: \`${release.releaseTitle}\`\n`;
            if (payload.downloadClient) message += `▫️ *Client*: ${payload.downloadClient}`;
        } else if (eventType === "Download") {
            message = `✅ *Radarr*: Download complete for *${eventTitle}*\n\n`;
            message += `▫️ *Quality*: ${release.quality}\n`;
            if (payload.downloadClient) message += `▫️ *Client*: ${payload.downloadClient}`;

            // Check for individual user notification subscriptions
            try {
                const pending = getPendingNotifications('movie', movie.tmdbId);
                for (const sub of pending) {
                    const personalMsg = `🔔 *Notification*: Your movie *${sub.title}* has finished downloading and is now available! 🍿`;
                    await bot.api.sendMessage(sub.user_id, personalMsg, { parse_mode: "Markdown" });
                    markNotificationSent(sub.id);
                }
            } catch (err) {
                console.error("Failed to process pending Radarr notifications:", (err as Error).message);
            }
        }

        // Always save the event to the DB, construct a plain fallback message if one wasn't generated above
        const dbMessage = message ? message.replace(/[_*`]/g, "") : `Radarr Event: ${eventType} - ${eventTitle}`;
        saveMediaEvent("radarr", eventType.toLowerCase(), eventTitle, dbMessage);

        if (message) {
            const notifyChatId = process.env.WEBHOOK_NOTIFY_CHAT_ID || process.env.ALLOWED_USER_IDS?.split(",")[0];
            if (notifyChatId && areNotificationsEnabled() && getEventAlertConfig("radarr", eventType.toLowerCase())) {
                await bot.api.sendMessage(notifyChatId, message, { parse_mode: "Markdown" });
            }
        }

        return new Response("OK", { status: 200 });
    } catch (err) {
        console.error("Error processing Radarr webhook:", (err as Error).message);
        return new Response("Internal Server Error", { status: 500 });
    }
}

export async function handleSonarrWebhook(request: Request, bot: Bot) {
    try {
        const payload = (await request.json()) as SonarrWebhookPayload;
        const { eventType, series, episodes, release } = payload;

        if (eventType === "Test") {
            return new Response("OK", { status: 200 });
        }

        let message = "";
        const episodesLabel = episodes && episodes.length > 0
            ? episodes.map(e => `S${e.seasonNumber.toString().padStart(2, '0')}E${e.episodeNumber.toString().padStart(2, '0')}`).join(", ")
            : "";
        let eventTitle = `${series.title}${episodesLabel ? ` - ${episodesLabel}` : ""}`;

        if (eventType === "Grab") {
            message = `📥 *Sonarr*: Grabbed *${eventTitle}*\n\n`;
            if (release) message += `▫️ *Quality*: ${release.quality}\n`;
            if (release?.releaseTitle) message += `▫️ *Release*: \`${release.releaseTitle}\`\n`;
            if (payload.downloadClient) message += `▫️ *Client*: ${payload.downloadClient}`;
        } else if (eventType === "Download") {
            message = `✅ *Sonarr*: Download complete for *${eventTitle}*\n\n`;
            if (release) message += `▫️ *Quality*: ${release.quality}\n`;
            if (payload.downloadClient) message += `▫️ *Client*: ${payload.downloadClient}`;

            // Check for individual user notification subscriptions
            try {
                const pending = getPendingNotifications('series', series.tvdbId);
                for (const sub of pending) {
                    const personalMsg = `🔔 *Notification*: The show *${sub.title}* has finished downloading and is now available! 📺`;
                    await bot.api.sendMessage(sub.user_id, personalMsg, { parse_mode: "Markdown" });
                    markNotificationSent(sub.id);
                }
            } catch (err) {
                console.error("Failed to process pending Sonarr notifications:", (err as Error).message);
            }
        } else if (eventType === "SeriesAdd") {
            message = `📺 *Sonarr*: Added new series *${eventTitle}*\n`;
        } // Handle SeriesAdd if received

        // Always save the event to the DB, construct a plain fallback message if one wasn't generated above
        const dbMessage = message ? message.replace(/[_*`]/g, "") : `Sonarr Event: ${eventType} - ${eventTitle}`;
        saveMediaEvent("sonarr", eventType.toLowerCase(), eventTitle, dbMessage);

        if (message) {
            const notifyChatId = process.env.WEBHOOK_NOTIFY_CHAT_ID || process.env.ALLOWED_USER_IDS?.split(",")[0];
            if (notifyChatId && areNotificationsEnabled() && getEventAlertConfig("sonarr", eventType.toLowerCase())) {
                await bot.api.sendMessage(notifyChatId, message, { parse_mode: "Markdown" });
            }
        }

        return new Response("OK", { status: 200 });
    } catch (err) {
        console.error("Error processing Sonarr webhook:", (err as Error).message);
        return new Response("Internal Server Error", { status: 500 });
    }
}

/**
 * Returns true if the given string contains characters outside the Latin/ASCII range,
 * indicating it may be a non-English/non-Spanish title (e.g. Japanese, Korean, Chinese, Arabic).
 */
export function isNonLatinTitle(title: string): boolean {
    // Match any character outside Basic Latin, Latin-1 Supplement, and common Latin Extended blocks
    return /[^\u0000-\u024F\u1E00-\u1EFF]/.test(title);
}

export function withEnglishTitle(displayedTitle: string, originalTitle: string | undefined): string {
    if (!originalTitle) return displayedTitle;
    if (originalTitle === displayedTitle) return displayedTitle;
    // Show original title in parentheses whenever it differs from the displayed title
    return `${displayedTitle} (${originalTitle})`;
}

/**
 * Generates a unique session ID for tracking playback state.
 */
function getSessionId(payload: PlexWebhookPayload): string {
    const accountId = payload.Account?.id || "anon";
    const playerUuid = payload.Player?.uuid || "unknown_player";
    const ratingKey = payload.Metadata?.ratingKey || "unknown_item";
    return `plex_${accountId}_${playerUuid}_${ratingKey}`;
}

function formatWebhookMessage(payload: PlexWebhookPayload, previousState: string | null): string | undefined {
    const { event, Metadata, Account } = payload;
    const user = Account?.title || "Someone";
    const typeLabel = Metadata?.librarySectionType === "show" ? "an episode of" : "the movie";

    switch (event) {
        case "media.play":

        case "media.play":
            return `🎬 *${user}* started watching ${typeLabel} *${getFullTitle(Metadata)}*`;

        case "media.resume":
            // Only notify if the previous action was NOT a pause (Title: "Continue" logic)
            if (previousState === "media.pause") {
                console.log(`Plex Webhook: Skipping redundant resume for ${Metadata?.title}`);
                return undefined;
            }
            return `▶️ *${user}* resumed watching ${typeLabel} *${getFullTitle(Metadata)}*`;

        case "media.pause":
            // We update state in handlePlexWebhook but never notify on pause to reduce noise
            console.log(`Plex Webhook: Ignored event ${event} (state updated)`);
            return undefined;

        case "media.scrobble":
            return `✅ *${user}* finished watching ${typeLabel} *${getFullTitle(Metadata)}*`;

        case "library.new":
            const itemType = Metadata?.type === 'episode' ? 'Episode' : 'Movie';
            return `🆕 *New ${itemType} added!*\n\n*${getFullTitle(Metadata)}* is now ready to watch.`;

        default:
            console.log(`Plex Webhook: Ignored event ${event}`);
            return undefined;
    }
}

function getFullTitle(metadata: PlexWebhookPayload["Metadata"]): string {
    const title = metadata.title || "Unknown Item";
    const originalTitle = metadata.originalTitle;

    if (metadata.type === "episode") {
        const episodeTitle = withEnglishTitle(title, originalTitle);
        const season = metadata.parentIndex !== undefined ? `S${metadata.parentIndex.toString().padStart(2, '0')}` : 'S??';
        const episode = metadata.index !== undefined ? `E${metadata.index.toString().padStart(2, '0')}` : 'E??';
        return `${metadata.grandparentTitle} - ${season}${episode} - ${episodeTitle}`;
    }

    return withEnglishTitle(title, originalTitle);
}
