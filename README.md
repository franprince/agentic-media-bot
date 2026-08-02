# 🤖 Agentic Media Bot

An intelligent Telegram bot that acts as your personal media assistant. Powered by LLMs (LLM with tool-calling capabilities), it seamlessly manages your local media library across Plex, Radarr, Sonarr, and qBittorrent.

---

## ✨ Features

- **🗣️ Natural Language Interface**: Talk to your library in English or Spanish.
- **🎬 Movie & TV Management**: Add, search, and discover media via Radarr and Sonarr.
- **🎥 Plex Integration**: Browse your library, check stats, and find movies by genre, country, or duration.
- **⏬ Torrent Control**: Monitor and manage your qBittorrent downloads.
- **🧠 Multi-Step Reasoning**: The agent can perform complex audits (e.g., "Find all Japanese horror movies added last month that I don't have in 4K").
- **🚀 One-Step Setup**: Includes an interactive CLI tool to guide you through configuration.

---

## 📦 Scope

This bot is designed for one household: a single bot instance connects to
one arr stack (one Radarr, one Sonarr, one Plex, one qBittorrent/NZBGet).
Every Telegram user listed in `ALLOWED_USER_IDS` shares that same library
and download queue. It is not a multi-tenant/SaaS tool — there's no way for
different users to each connect their own separate arr stack to one bot.

---

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) runtime installed.
- Access to Radarr, Sonarr, Plex, and qBittorrent.
- A Telegram Bot Token from [@BotFather](https://t.me/BotFather).

### Quick Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/agentic-media-bot.git
   cd agentic-media-bot
   ```

2. **Install dependencies**:
   ```bash
   bun install
   ```

3. **Configure the environment**:
   Run the interactive setup tool to generate your `.env.local` file:
   ```bash
   bun src/setup.ts
   ```
   *The tool will guide you through getting your API keys and Plex token.*

4. **Start the bot**:
   ```bash
   bun run src/bot.ts
   ```

---

## 🛠️ Configuration Guide

If you prefer manual configuration, copy `.env.example` to `.env.local` and fill in the values.
`.env.example` documents every variable the bot reads, grouped by required
vs. optional feature — that file is the source of truth. `bun src/setup.ts`
walks through the required ones (and several optional ones) interactively.

### Finding your tokens:

- **Telegram Bot Token**: Message [@BotFather](https://t.me/BotFather) and use `/newbot`.
- **Plex Token**: [Follow this guide](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/) to find your `X-Plex-Token` using the XML method.
- **Radarr/Sonarr API Key**: Go to `Settings > General > Security`.
- **User ID**: Message [@userinfobot](https://t.me/userinfobot) to get your Telegram ID for `ALLOWED_USER_IDS`.

---

## 📊 Bot Logs

The bot performs a startup verification. A successful startup should look like this:

```text
✨ Verification complete.
✅ Bot is online and listening as @your_bot_name
✅ Radarr: Online
✅ Sonarr: Online
✅ Plex: Online
✅ qBittorrent: Online
🚀 Bot is ready for messages on Telegram.
```

## ⚙️ How to Manage the Bot

If you installed the bot as a systemd user service, you can use these commands:

- **Check Status**: `systemctl --user status agentic-media-bot`
- **View Logs**: `journalctl --user -u agentic-media-bot -f`
- **Restart**: `systemctl --user restart agentic-media-bot`
- **Stop**: `systemctl --user stop agentic-media-bot`

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.
