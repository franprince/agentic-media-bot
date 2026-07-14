# Project Rules

- **NEVER LAUNCH THE BOT (BRAIN) LOCALLY**: You must NEVER run the bot (`src/bot.ts` or `bot.js`) on this local machine. Running it here will cause Telegram 409 conflicts and crash the remote production instance. Only run and restart the proxy service (`agentic-media-proxy`).
