# Technical Specification: Agentic Media Bot

## Core Technologies
- **Runtime:** `bun`
- **Language:** TypeScript (`strict` true)
- **Bot Framework:** `grammy`
- **AI Integration:** `@ai-sdk/google` (`gemini-2.5-flash`) utilizing tool calling.
- **HTTP Client:** Native `fetch` API.

## Project Structure
- `src/bot.ts`: Entry point. Initializes Telegram webhook/polling.
- `src/agent/index.ts`: LLM abstraction. Handles message history, injects system prompt, and parses tool/function calls.
- `src/services/radarr.ts`: Simple wrapper for Radarr V3 API.
- `src/services/sonarr.ts`: Simple wrapper for Sonarr V3 API.
- `src/services/qbittorrent.ts`: Wrapper for qBittorrent WebUI API.
- `src/services/plex.ts`: Wrapper for Plex Media Server API.
- `src/types/`: TypeScript interfaces representing external payloads.

## Security & Authentication
- The bot must implement an allowlist of Telegram User IDs. If a message is received from an unknown ID, it should be ignored or gracefully rejected.
- API keys for Radarr, Sonarr, Plex, and Gemini must be injected via read-only `.env` file.

## AI Agent Design
- The agent utilizes an LLM capable of function calling. 
- State is stateless per-request but keeps a bounded history within the Telegram session.
- System prompt strongly guides the agent to use tools rather than answering based on local knowledge.
