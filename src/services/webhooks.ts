import { Bot, InputFile } from "grammy";
import { getPosterUrl, getItemMetadata } from "./plex";
import { areNotificationsEnabled, getPlaybackState, updatePlaybackState } from "./database";
import { clearCache } from "../agent/tools";

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

        // Enrich metadata if originalTitle is missing
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
            if (!areNotificationsEnabled()) {
                console.log(`Plex Webhook: Notifications are disabled, skipping ${payload.event}`);
                return new Response("Notifications disabled", { status: 200 });
            }

            const PLEX_URL = process.env.PLEX_URL?.trim();
            const PLEX_TOKEN = process.env.PLEX_TOKEN?.trim();

            const thumb = payload.Metadata?.thumb || payload.Metadata?.parentThumb || payload.Metadata?.grandparentThumb;
            const thumbUrl = (thumb && PLEX_URL && PLEX_TOKEN) ? getPosterUrl(thumb) : undefined;

            try {
                if (thumbUrl) {
                    // Fetch image locally to avoid sending 'localhost' URLs to Telegram
                    // Add timeout and retry logic for robustness
                    let response: Response | null = null;
                    let lastError: Error | null = null;

                    for (let attempt = 1; attempt <= 3; attempt++) {
                        try {
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

                            response = await fetch(thumbUrl, {
                                signal: controller.signal,
                                headers: { 'User-Agent': 'agentic-media-bot/1.0' }
                            });

                            clearTimeout(timeoutId);

                            if (response.ok) {
                                break; // Success, exit retry loop
                            } else {
                                lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
                            }
                        } catch (err) {
                            lastError = err as Error;
                            console.warn(`Webhook image fetch attempt ${attempt} failed:`, lastError.message);
                        }

                        if (attempt < 3) {
                            // Exponential backoff: 1s, 2s
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

                // Fallback to plain text if markdown fails
                try {
                    const plainTextMessage = message.replace(/[_*`]/g, "");
                    await bot.api.sendMessage(notifyChatId, plainTextMessage);
                    console.info("Successfully sent fallback plain text message");
                } catch (fallbackErr) {
                    const fallbackError = fallbackErr as Error;
                    console.error("Failed to send fallback message:", {
                        error: fallbackError.message,
                        stack: fallbackError.stack
                    });
                }
            }
        }

        return new Response("OK", { status: 200 });
    } catch (error) {
        const err = error as Error;
        console.error("Error processing Plex webhook:", {
            error: err.message,
            stack: err.stack,
            timestamp: new Date().toISOString(),
            url: request.url,
            method: request.method
        });
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
        case "library.new": {
            const type = Metadata?.librarySectionType === "show" ? "Episode" : "Movie";
            return `🆕 *New ${type} added:*\n*${getFullTitle(Metadata)}*`;
        }

        case "media.play":
            return `🎬 *${user}* started watching ${typeLabel}:\n*${getFullTitle(Metadata)}*`;

        case "media.resume":
            // Only notify if the previous action was NOT a pause (Title: "Continue" logic)
            if (previousState === "media.pause") {
                console.log(`Plex Webhook: Skipping redundant resume for ${Metadata?.title}`);
                return undefined;
            }
            return `▶️ *${user}* resumed watching ${typeLabel}:\n*${getFullTitle(Metadata)}*`;

        case "media.pause":
            // We update state in handlePlexWebhook but never notify on pause to reduce noise
            console.log(`Plex Webhook: Ignored event ${event} (state updated)`);
            return undefined;

        case "media.scrobble":
            return `✅ *${user}* finished watching ${typeLabel}:\n*${getFullTitle(Metadata)}*`;

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
