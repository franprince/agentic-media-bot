import { Bot } from "grammy";
import { run } from "@grammyjs/runner";
import { processUserMessage } from "./agent/index.ts";
import { checkAllServices } from "./services/health";

// Setup telegram bot using the token from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is not set.");
}

const bot = new Bot(token);

// Handle incoming /start command
bot.command("start", (ctx) => {
    ctx.reply("Hello! I am your Agentic Media Bot. How can I help you manage your media today?\n\nCommands:\n/status - Check service health");
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

// Handle text messages
bot.on("message:text", async (ctx) => {
    const userId = ctx.from.id;
    const user = ctx.from.username || ctx.from.first_name;
    console.log(`📩 Message from @${user} (${userId}): ${ctx.message.text}`);

    await ctx.replyWithChatAction("typing");
    const replyText = await processUserMessage(userId, ctx.message.text);
    await ctx.reply(replyText);
});

bot.catch((err: unknown) => {
    console.error("Error in bot:", err);
});

console.log("Starting the bot...");
// Use grammyjs/runner to handle graceful restarts and long-polling concurrently
const runner = run(bot);

bot.api.getMe().then((me) => {
    console.log(`✅ Bot is online and listening as @${me.username}`);
    console.log("Wait for messages on Telegram...");
});
