import { Bot, InlineKeyboard, InputFile } from "grammy";
import { detectStatusLanguage } from "../agent/status.ts";
import { setUserName } from "../services/database.ts";
import { getAllowedUserIdSet } from "./auth.ts";
import { transcribeAudio } from "../services/transcription";
import { processUserMessage } from "../agent/index.ts";
import { splitTelegramMessage } from "./utils.ts";

export function getLocalizedThinkingStatus(text: string | undefined): string {
    const lang = detectStatusLanguage(text);
    return lang === "es" ? "⏳ _Pensando..._" : "⏳ _Thinking..._";
}

export function getLocalizedCatchupStatus(text: string | undefined): string {
    const lang = detectStatusLanguage(text);
    return lang === "es"
        ? "👋 _Hola, volvi a estar en linea. Voy a retomar tu ultimo pedido..._"
        : "👋 _Hello! I'm back online. Let me catch up on your last request..._";
}

export function extractUserTextFromHistoryMessage(message: any): string | undefined {
    if (!message || message.role !== "user") return undefined;
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
        const textPart = message.content.find((part: any) => part?.type === "text" && typeof part?.text === "string");
        return textPart?.text;
    }
    return undefined;
}

export async function sendPhotoSmart(ctx: any, userId: number | string, imageUrl: string | undefined, options: any) {
    if (!imageUrl) return;

    let finalUrl = imageUrl;
    if (imageUrl.startsWith("/")) {
        const isSonarr = imageUrl.includes("sonarr") || imageUrl.includes("MediaCoverProxy");
        const baseUrl = isSonarr 
            ? (process.env.SONARR_URL || "http://localhost:8989")
            : (process.env.RADARR_URL || "http://localhost:7878");
        finalUrl = baseUrl.replace(/\/$/, "") + imageUrl;
    }

    const isLocal = finalUrl.includes("localhost") || finalUrl.includes("127.0.0.1");

    if (isLocal) {
        try {
            const response = await fetch(finalUrl);
            if (response.ok) {
                const buffer = await response.arrayBuffer();
                const urlPart = finalUrl.split("?")[0]?.split("/").pop() ?? "";
                const extension = urlPart.includes(".") ? (urlPart.split(".").pop() ?? "jpg") : "jpg";
                const filename = `thumb.${extension}`;

                return await ctx.api.sendPhoto(userId, new InputFile(Buffer.from(buffer), filename), options);
            }
        } catch (err) {
            console.warn(`⚠️ Failed to fetch local image: ${finalUrl}. Falling back to remote or text.`, (err as Error).message);
        }
    }

    return await ctx.api.sendPhoto(userId, finalUrl, options);
}

export async function safeReply(
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
            if ((index + 1) % 1 === 0) keyboard.row();
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

export async function handleUserText(ctx: any, userId: number, userText: string, username: string | number) {
    if (userText.startsWith("/")) return;
    console.log(`📩 Message from @${username} (${userId}): ${userText}`);

    await ctx.replyWithChatAction("typing");

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

    try {
        await ctx.api.deleteMessage(userId, statusMsg.message_id);
    } catch (err) {
        // Ignore
    }

    await safeReply(ctx, text, imageUrl, username, buttons);
}

export function registerMessageHandlers(bot: Bot<any, any>, token: string | undefined, waitingForName: Map<number, { waitingForName: true }>) {
    // Handle text messages
    bot.on("message:text", async (ctx) => {
        if (!ctx.from) return;

        const userId = ctx.from.id;

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

            await ctx.api.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                `🗣️ _"${transcription}"_`,
                { parse_mode: "Markdown" }
            );

            await handleUserText(ctx, userId, transcription, username);
        } catch (error: any) {
            console.error("Failed to transcribe voice note:", error);
            let msg = error.message || "Unknown error";
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

    // Handle button clicks by re-routing the callback data to the agent.
    bot.on("callback_query:data", async (ctx) => {
        const userId = ctx.from.id;
        const userText = ctx.callbackQuery.data;
        const username = ctx.from.username || ctx.from.first_name;

        await ctx.answerCallbackQuery();
        await handleUserText(ctx, userId, userText, username);
    });
}
