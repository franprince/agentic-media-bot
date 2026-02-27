import { Bot, InputFile } from "grammy";
import { getPosterUrl } from "./plex";
import { areNotificationsEnabled } from "./database";

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
                    const response = await fetch(thumbUrl);
                    if (response.ok) {
                        const buffer = await response.arrayBuffer();
                        const urlPart = thumbUrl!.split("?")[0];
                        const extension = urlPart!.split(".").pop() || "jpg";
                        const filename = `thumb.${extension}`;
                        await bot.api.sendPhoto(notifyChatId, new InputFile(Buffer.from(buffer), filename), {
                            caption: message,
                            parse_mode: "Markdown"
                        });
                    } else {
                        throw new Error(`Failed to fetch thumb: ${response.statusText}`);
                    }
                } else {
                    await bot.api.sendMessage(notifyChatId, message, { parse_mode: "Markdown" });
                }
            } catch (err) {
                console.error("Failed to send webhook notification:", err);
                // Fallback to plain text if markdown fails
                await bot.api.sendMessage(notifyChatId, message.replace(/[_*`]/g, ""));
            }
        }

        return new Response("OK", { status: 200 });
    } catch (error) {
        console.error("Error processing Plex webhook:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
}

function formatWebhookMessage(payload: PlexWebhookPayload): string | undefined {
    const { event, Metadata, Account } = payload;
    const title = Metadata?.title || "Unknown Title";
    const user = Account?.title || "Someone";

    switch (event) {
        case "library.new":
            const type = Metadata?.librarySectionType === "show" ? "Episode" : "Movie";
            let displayTitle = title;
            if (Metadata?.grandparentTitle) {
                displayTitle = `${Metadata.grandparentTitle} - S${Metadata.parentIndex}E${Metadata.index} - ${title}`;
            }
            return `🆕 *New ${type} added:*\n*${displayTitle}*`;

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
        return `${metadata.grandparentTitle} - S${metadata.parentIndex}E${metadata.index} - ${metadata.title}`;
    }
    if (metadata.type === "movie") {
        return metadata.title;
    }
    return metadata.title || "Unknown Item";
}
