# Technical Specification: Agentic Media Bot

## Core Technologies
- **Runtime:** `bun`
- **Language:** TypeScript (`strict` true)
- **Bot Framework:** `grammy`
- **AI Integration:** `@ai-sdk/google` (`gemini-2.0-flash`) or `ollama-ai-provider` for local execution (e.g., `llama3.1`). Utilizes tool calling with `maxSteps: 5` for multi-step reasoning.
- **HTTP Client:** Native `fetch` API.

## Project Structure
- `src/bot.ts`: Entry point. Initializes Telegram bot, logs incoming traffic, and handles direct commands like `/start` and `/status`.
, and handles direct commands like `/start` and `/status`.
- `src/agent/index.ts`: LLM abstraction. Handles message history, conditional model loading, and iterative tool execution.
- `src/services/`: Modular wrappers for Radarr, Sonarr, qBittorrent, and Plex APIs.
- `src/agent/tools.ts`: Unified tool repository for AI integration.
- `src/types/`: TypeScript interfaces representing external payloads.

## Security & Authentication
- The bot must implement an allowlist of Telegram User IDs. If a message is received from an unknown ID, it should be ignored or gracefully rejected.
- API keys for Radarr, Sonarr, Plex, and Gemini must be injected via read-only `.env` file.

## AI Agent Design
- The agent utilizes an LLM capable of function calling.
- State is stateless per-request but keeps a bounded history within the Telegram session.
- System prompt strongly guides the agent to use tools rather than answering based on local knowledge.
- Recursive execution loop (`maxSteps: 5`) allows the agent to audit libraries across multiple sections.
- **Auditing Intelligence:** Includes specialized tools for finding genre-specific content across multiple internal Plex IDs and identifying missing episodes with granular metadata.
- **Local Adaptation:** System prompt contains strict technical protocols to ensure reliable tool adherence on local LLMs.
