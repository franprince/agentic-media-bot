# Project Rules

- **NEVER LAUNCH THE BOT (BRAIN) LOCALLY**: You must NEVER run the bot (`src/bot.ts` or `bot.js`) on this local machine. Running it here will cause Telegram 409 conflicts and crash the remote production instance. Only run and restart the proxy service (`agentic-media-proxy`). For the same reason, never call Telegram's `getUpdates` as a probe — it conflicts with the production bot's long polling.
- **READ `DEPLOYMENT.md` BEFORE DEBUGGING DELIVERY**: The bot runs on a remote Coolify VPS reached over Tailscale; the proxy runs locally. `localhost` in the proxy's config does **not** mean the bot. `DEPLOYMENT.md` documents both traffic directions and per-hop verification commands.
