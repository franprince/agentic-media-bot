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

### Finding your tokens:

- **Telegram Bot Token**: Message [@BotFather](https://t.me/BotFather) and use `/newbot`.
- **Plex Token**: [Follow this guide](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/) to find your `X-Plex-Token` using the XML method.
- **Radarr/Sonarr API Key**: Go to `Settings > General > Security`.
- **User ID**: Message [@userinfobot](https://t.me/userinfobot) to get your Telegram ID for `ALLOWED_USER_IDS`.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.
