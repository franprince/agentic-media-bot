import { Bot } from "grammy";
import { run } from "@grammyjs/runner";
import { processUserMessage } from "./agent/index.ts";

// Setup telegram bot using the token from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is not set.");
}

const bot = new Bot(token);

// Handle incoming /start command
bot.command("start", (ctx) => {
    ctx.reply("Hello! I am your Agentic Media Bot. How can I help you manage your media today?");
});

// Handle text messages
bot.on("message:text", async (ctx) => {
    const userId = ctx.from.id;
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
