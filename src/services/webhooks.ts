import { Bot, InputFile } from "grammy";
import { getPosterUrl } from "./plex";
import { areNotificationsEnabled } from "./database";
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
        
        // Invalidate cache when library content changes
        if (payload.event === "library.new") {
            console.log("🗂️ Plex library updated, invalidating cache...");
            clearCache();
        }

        const notifyChatId = process.env.WEBHOOK_NOTIFY_CHAT_ID || process.env.ALLOWED_USER_IDS?.split(",")[0];

        if (!notifyChatId) {
            console.warn("⚠️ No notification chat ID configured for webhooks.");
            return new Response("No notification target", { status: 200 });
        }

        const message = formatWebhookMessage(payload);
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

/**
 * Appends the English/original title in parentheses when the primary title is non-Latin
 * and an originalTitle is available that differs from the displayed title.
 * Implements the "Title Localization Protocol" from the functional spec.
 */
export function withEnglishTitle(displayedTitle: string, originalTitle: string | undefined): string {
    if (!originalTitle) return displayedTitle;
    if (originalTitle === displayedTitle) return displayedTitle;
    if (isNonLatinTitle(displayedTitle) || isNonLatinTitle(originalTitle)) {
        // Show original (English) title in parentheses alongside the non-Latin title
        return `${displayedTitle} (${originalTitle})`;
    }
    return displayedTitle;
}

function formatWebhookMessage(payload: PlexWebhookPayload): string | undefined {
    const { event, Metadata, Account } = payload;
    const title = Metadata?.title || "Unknown Title";
    const user = Account?.title || "Someone";

    switch (event) {
        case "library.new": {
            const type = Metadata?.librarySectionType === "show" ? "Episode" : "Movie";
            let displayTitle = withEnglishTitle(title, Metadata?.originalTitle);
            if (Metadata?.grandparentTitle) {
                const episodeTitle = withEnglishTitle(title, Metadata?.originalTitle);
                displayTitle = `${Metadata.grandparentTitle} - S${Metadata.parentIndex}E${Metadata.index} - ${episodeTitle}`;
            }
            return `🆕 *New ${type} added:*\n*${displayTitle}*`;
        }

        case "media.play":
            return `🎬 *${user}* started watching:\n*${getFullTitle(Metadata)}*`;

        case "media.scrobble":
            return `✅ *${user}* finished watching:\n*${getFullTitle(Metadata)}*`;

        default:
            console.log(`Plex Webhook: Ignored event ${event}`);
            return undefined;
    }
}

function getFullTitle(metadata: PlexWebhookPayload["Metadata"]): string {
    if (metadata.type === "episode") {
        const episodeTitle = withEnglishTitle(metadata.title, metadata.originalTitle);
        return `${metadata.grandparentTitle} - S${metadata.parentIndex}E${metadata.index} - ${episodeTitle}`;
    }
    if (metadata.type === "movie") {
        return withEnglishTitle(metadata.title, metadata.originalTitle);
    }
    return withEnglishTitle(metadata.title || "Unknown Item", metadata.originalTitle);
}
