# Technical Specification: Agentic Media Bot

## Core Technologies
- **Runtime:** `bun`
- **Language:** TypeScript (`strict` true)
- **Bot Framework:** `grammy`
- **AI Integration:** `@ai-sdk/google` (`gemini-2.0-flash`) or `ollama-ai-provider` for local execution (e.g., `llama3.1`). Utilizes tool calling with `maxSteps: 5` for multi-step reasoning.
- **HTTP Client:** Native `fetch` API.
- **Testing:** `bun:test` for unit/integration tests, using **Mock Service Worker (MSW)** for network interception and service mocking.

## Project Structure
- `src/bot.ts`: Entry point. Initializes Telegram bot, logs incoming traffic, and handles direct commands like `/start` and `/status`.
- `src/setup.ts`: Standalone interactive CLI tool for initial configuration and dependency installation.
- `src/agent/index.ts`: LLM abstraction. Handles message history, conditional model loading, and iterative tool execution.
- `src/services/`: Modular wrappers for Radarr, Sonarr, qBittorrent, and Plex APIs.
- `src/agent/tools.ts`: Unified tool repository for AI integration.
- `src/services/database.ts`: Persistence layer using `bun:sqlite` for conversation history and user personalization (names).
- `src/services/webhooks.ts`: Webhook handler for external service integration (e.g., Plex).
- `src/types/`: TypeScript interfaces representing external payloads.

## Security & Authentication
- The bot must implement an allowlist of Telegram User IDs. If a message is received from an unknown ID, it should be ignored or gracefully rejected.
- API keys for Radarr, Sonarr, Plex, and Gemini must be injected via read-only `.env` file.
- `/restart` command authorization is enforced using `ALLOWED_USER_IDS`.
- `/restart` stops the current polling runner, launches `scripts/restart-bot.sh` as a detached supervisor (passing current PID + absolute script path), and exits the current process; the supervisor waits for shutdown, force-kills if needed, and starts a fresh process with Bun. Restart paths resolve from project root instead of current shell directory. `BOT_RESTART_COMMAND` can override this behavior. If supervisor launch fails, it retries with a detached `nohup` fallback before in-process runner fallback.
- `/restart` persists the requester chat ID and, on successful startup, sends a localized "back online" confirmation once, then clears the notification metadata.
- Slash commands are excluded from generic `message:text` LLM handling to avoid command leakage into tool-calling flow.

## AI Agent Design
- The agent utilizes an LLM capable of function calling.
- **Context Management**: Conversation history is stateless per-request but keeps a bounded history within the Telegram session. The `trimHistory` logic (in `src/services/database.ts`) prunes history to the last 20 messages to maintain model focus and avoid context "stickiness".
- System prompt strongly guides the agent to use tools rather than answering based on local knowledge.
- Recursive execution loop (`maxSteps: 5`) allows the agent to audit libraries across multiple sections (movies and shows).
- **Auditing Intelligence**: Includes specialized tools for finding genre-specific content across multiple internal Plex IDs and identifying missing episodes with granular metadata.
- **Local Adaptation**: System prompt contains strict technical protocols to ensure reliable tool adherence on local LLMs.
- **Tool-Argument Guardrails**: Tool schemas tolerate missing IDs, but execution returns a "search first" response with suggestions to avoid invalid tool calls and crashes.
- **Radarr Search Resilience**: If Radarr lookup fails during a title-based add, return a user-facing error instead of crashing.
- **Tool Error Containment**: Radarr tool execution paths should return structured error messages for API 4xx/5xx responses rather than throw and abort the full LLM turn.
- **Defensive Tool Filtering**: Before tool execution, the agent filters out any `undefined` tool mappings in `src/agent/index.ts` to prevent AI SDK crashes (`TypeError: tool2.type`).
- **IMDb Validation & Interactive Config**: `addMovieTool` and `addSeriesTool` prioritize search-by-id when an `imdbId` is provided. They now also return available quality profiles and root folders when `confirm` is false.
- **Anime Detection**: `addSeriesTool` automatically detects Anime (via genres) and sets `seriesType: "anime"` in Sonarr POST payloads.
- **Restricted Notifications**: Plex webhook notifications are restricted to playback events (play, resume, scrobble). Library additions (`library.new`) trigger internal cache invalidation but do not send outward notifications.
- **History Migration**: Dynamically renames legacy tool calls in the conversation history to maintain compatibility with updated tool schemas.
- **Real-time Status Feed**: Captures "thinking" preamble from the LLM to provide localized, real-time status updates via the Telegram `onStep` callback.
- **Localized Entry Status**: `src/bot.ts` localizes initial "thinking" and restart catch-up status messages based on detected user-message language.
- **Final Language Enforcement**: `processUserMessage` performs a post-generation language guard; if output language does not match the detected user language (es/en), it rewrites the final text in the target language while preserving content/format.
- **Deterministic Count Prefix**: Final responses prepend a localized exact-count line for Plex country/genre tool results using `totalFound`.
- **Count Source of Truth**: Exact-count prefixes must use tool results from the execution pass (`firstPass`) even when a synthesis model generates the final prose.
- **Plex Tag-Key Normalization**: Country/genre filters parse Plex tag keys that may arrive as full query paths (not only numeric IDs), ensuring accurate filter requests.
- **Plex Direct Tag-Path Preference**: When Plex provides a full filter path in tag keys, the service uses that path directly to preserve server-side filter semantics.
- **Deterministic Plex Browse Rendering**: Final text for Plex country/genre browse requests (`searchPlexByCountry` / `searchPlexByGenre`) is generated from tool payload (`totalFound` + `sampleItems`) rather than relying only on LLM prose.
- **Deterministic List Label**: Plex country/genre search tools return `queryType` + `searchParam` + `listLabel` so output uses "This is the list of {genre} media:" for genres and "This is the list of media from {country}:" for countries.
- **Country Noun Normalization**: Status rendering and prompt rules normalize country demonyms to country nouns to keep tool intent explicit and logs consistent.
- **Tool-Boundary Country Canonicalization**: `searchPlexByCountry` normalizes demonyms to country nouns in the tool schema before execution.
- **Single Country Canonicalizer**: Country normalization for tool execution, status rendering, and tool-call logging is centralized in `src/services/plex.ts` to avoid drift.
- **Accent-Resilient I18N Detection**: Status language detection handles common Spanish forms with and without diacritics.
- **Plex Result Deduplication**: Country/genre aggregation across multiple movie and show sections deduplicates media entries before computing `totalFound`.
- **Strict Country Tag Filter**: After Plex country browsing, each item is verified by fetching metadata and checking `Country` tags against the requested country; language tags are ignored and primary-country matching is used by default.
- **Title-Level Country Verification**: `searchPlexByTitleOnly` includes normalized `countries` and `primaryCountry` so country yes/no answers are grounded in Plex metadata.
- **Ranked Country Query Support**: `searchPlexByCountry` supports `ranked` and `limit` arguments and orders results by available Plex rating fields for top-N responses.
- ** deterministic Original-Title Rendering**: `buildPlexBrowseAuthoritativeText` and webhook notifications append `originalTitle` when different from displayed title.
- **Browse Title Enrichment**: Ranked country sample items fetch Plex item metadata and fallback to `titleSort` when `originalTitle` is unavailable.
- **Cross-Service Alias Recovery**: When foreign-script titles still lack Latin aliases after Plex metadata enrichment (in browse results or webhook notifications), the bot performs best-effort Radarr/Sonarr lookup (title/year) to recover English aliases.
- **Alias Fallback Rendering**: If `originalTitle` is missing, deterministic rendering can use enriched `aliasTitle`; if a non-Latin title still has no alias, output explicitly marks the English/Spanish alias as unavailable.
- **Intent-Based Tool Gating**: For detail/info/synopsis user intent, add tools (`addMovie`, `addSeries`) are removed from the tool set unless explicit add intent is detected.
- **Error Diagnostics**: The `/audit` command provides a deep-dive into `/tmp/agentic-media-bot-restart.log` to identify root causes of crashes.

## Webhook Server
- The bot includes an embedded web server powered by `Bun.serve`.
- **Default Port**: `3000` (configurable via `WEBHOOK_PORT`).
- **Endpoint**: `POST /plex-webhook`.
- **Payload Handling**: Parses `multipart/form-data` from Plex and extracts JSON `payload`.
- **Image Support**: If a thumbnail is specified, the service fetches it via local `fetch` and uploads it to Telegram as an `InputFile` to resolve `localhost` reachability issues.
- **Notification Target**: Uses `WEBHOOK_NOTIFY_CHAT_ID` or defaults to the first ID in `ALLOWED_USER_IDS`.
- **Toggle Persistence**: Notification preference is stored in the `metadata` table as `notifications_enabled` (string "true" or "false").
- **Conditional Activation**: The server only starts if `USE_PLEX_WEBHOOK` is set to `true` in environment variables.

## Startup Verification & Specification Auditing
- On every run, the bot MUST execute `src/verify-config.ts` (or equivalent) to audit its environment against `TECHNICAL_SPEC.md` and `FUNCTIONAL_SPEC.md`.
- **Validation Rules**:
    1. Check for missing environment variables.
    2. Ensure service connectivity.
    3. Verify that the agent's current tool set matches the functionalities described in the FUNCTIONAL_SPEC.
    4. Detect and warn about multiple running instances of the bot script to prevent 409 Conflict errors.
    5. If significant spec changes are detected since the last run, notify administrators.
- Startup catch-up can be skipped once after admin-triggered restart via metadata flag.
- Changelog data in `src/bot.ts` is maintained as semantic-versioned release entries, and startup notifications send the latest release once per version upgrade.
- Admin startup changelog notifications are chunked below Telegram's 4096-character message limit before sending.
- **Verification Logic:**
    - On every run, the bot executing `src/verify-config.ts` (or equivalent) to audit its environment against `TECHNICAL_SPEC.md` and `FUNCTIONAL_SPEC.md`.
    - **Deployment:** The bot MUST be restarted after any functional or technical update to apply changes and trigger the startup audit/changelog notification.

## Onboarding & Configuration
- **Interactive Setup**: `src/setup.ts` utilizes the native `prompt` and `fetch` APIs to provide a guided configuration experience without external heavy CLI frameworks.
- **Dependency Check**: Uses `existsSync` to detect `node_modules` and `Bun.spawnSync` for automated `bun install` execution.
- **Plex API Integration**: Performs a real-time probe of the user's Plex server during setup to fetch and display library section IDs, reducing manual configuration errors.
- **Launch on Startup (Systemd)**: Creates a user-level systemd service unit (`~/.config/systemd/user/agentic-media-bot.service`) on Linux, configured to use the local `bun` binary and project directory.
- **Environment Persistence**: Atomically writes gathered configuration to `.env.local`.
