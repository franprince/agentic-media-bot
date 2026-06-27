# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.32.8] - 2026-06-27

### Changed
- **Provider Reverted to Ollama**: Switched the active AI model provider back to Ollama with `gemma4:31b-cloud` model to avoid Google Gemini's strict rate limits and quota restrictions on the standard free tier.

## [4.32.7] - 2026-06-27

### Fixed
- **Consecutive User Messages Merging**: Implemented dynamic merging of consecutive `user` messages in `src/services/database.ts` when loading/saving conversation history. This prevents protocol crashes with Google's strict alternating roles requirement when multiple user events (e.g. text message + button click callback) are received back-to-back without a model turn in between.
- **History Unit Tests**: Updated `trimHistory` test data to realistic role alternation patterns to prevent role merging from skewing message count validations.

## [4.32.6] - 2026-06-27

### Fixed
- **Gemini Chat History Role Alternation**: Fixed a 400 Bad Request error from the Gemini API when processing history containing orphaned tool execution results (caused by previous synthesis crashes). When loading history, the bot now automatically injects a placeholder assistant message if a tool result is directly followed by a user message, maintaining the strict alternate-turn protocol required by Google's API.

## [4.32.5] - 2026-06-27

### Fixed
- **Gemini Chat Alternation (Synthesis Bug)**: Fixed a protocol violation in `src/agent/index.ts` where appending a synthesis prompt to the conversation messages created two consecutive `user` turns, throwing a 400 Bad Request error. Moved the synthesis instruction to the model's system prompt instead, ensuring strict user/model turn alternation.

## [4.32.4] - 2026-06-27

### Changed
- **Gemini Model Upgrade to 3.5-Flash**: Configured both fast and capable model tiers to use `gemini-3.5-flash` (instead of 2.5-flash and 2.5-pro) to avoid the Pro model's 0-request free-tier quota limits and the temporary 503 "High Demand" overloads on `gemini-2.5-flash`.
- **Config check model update**: Updated the verification model check in `src/verify-config.ts` to `gemini-3.5-flash`.

## [4.32.3] - 2026-06-27

### Fixed
- **Gemini API Tool Results Compatibility**: Resolved a crash under the Google provider (`@ai-sdk/google`) where tools returning arrays or primitives (e.g. `getSeriesQueue`) caused a serialization mismatch in conversational history. Wrap non-object tool responses in an object in both history saving and loading paths to adhere to the Gemini API's strict object-based `function_response` schema.

## [4.32.2] - 2026-06-27

### Fixed
- **qBittorrent Modern Cookie Support**: Fixed an authentication bug in `src/services/qbittorrent.ts` where modern qBittorrent instances use a port-specific cookie name (e.g. `QBT_SID_8080`) instead of `SID`. Updated the regex to support both legacy and modern cookie formats.
- **Gemini Verify Model**: Updated the verification model check in `src/verify-config.ts` from `gemini-1.5-flash` to `gemini-2.5-flash` to support newer GCP and Vertex-generated API keys which list modern models but not legacy 1.5 versions.

## [4.32.1] - 2026-06-27

### Fixed
- **Startup Crash**: Resolved a module side-effect in `src/verify-config.ts` where importing the configuration verification logic would immediately run the audit and call `process.exit(1)` on any offline services, causing the bot process to crash on startup. Wrapped the direct execution in `import.meta.main`.
- **Robust Tool Error Handling**: Added `try/catch` error handlers to the queue and download action tools (`getMovieQueueTool`, `getSeriesQueueTool`, `getTorrentsTool`, `pauseTorrentTool`, and `resumeTorrentTool`) in `src/agent/tools.ts` to return user-friendly service offline warnings instead of throwing unhandled exceptions and crashing the entire AI conversation session.
- **Plex Webhook Test**: Updated expectations in `src/services/__tests__/webhooks.test.ts` to align with the database event log return value change.
- **Sonarr Test Leak**: Refactored `src/services/__tests__/sonarr_robustness.test.ts` to track and clean up all spies after each test, preventing mock pollution from failing downstream tests.

## [4.32.0] - 2026-03-23


### Added
- **NZBGet Integration**: Enhanced the NZBGet service with RPC support for queue and status monitoring.
- **NZBGet Webhook Support**: Implemented a new webhook handler in the bot and proxy to process real-time events with speed and ETA.
- **Download Progress Tool**: Added `getNZBGetQueue` tool to the AI agent for natural language download status queries.
- **Comprehensive Documentation**: Created `BOT_DOCUMENTATION.md` and detailed architectural diagrams.

### Fixed
- **Button Rendering**: Enhanced the button extraction regex to correctly handle AI-generated bolding (`**BUTTON:**`), ensuring interactive options appear in Telegram.
- **Proxy Connectivity**: Restored missing `subscribeToDownloadTool` access on the proxy gateway by ensuring a clean restart and proper export indexing.
- **409 Conflict Resilience**: Restored the `restart-bot.sh` supervisor script and implemented a global error handler in the bot to gracefully manage long-polling conflicts.
- **TypeScript Type Safety**: Resolved a type mismatch in `src/agent/index.ts` where environment-sourced model names could be `undefined`.
- **Mermaid Syntax**: Fixed syntax errors in architectural diagrams within documentation.

## [4.31.0] - 2026-03-23

### Added
- **Unwatched Episodes Tool**: Implemented `getUnwatchedEpisodes` tool for Plex, allowing the bot to identify and list episodes the user hasn't watched yet for a specific series.
- **Enhanced Plex Metadata**: Updated internal types to track playback progress and episode indexing.
- **Download Notifications**: Added proactivity to the bot to ask users if they want notifications when a new movie or series finishes downloading. Webhooks now trigger personalized alerts when downloads are complete.

### Fixed
- **Instance Lock Conflict**: Refined the `acquireInstanceLock` logic in `src/bot.ts` to allow immediate takeover if the PID matches the current process (fixing issues where "new deployments kill themselves" in container environments like Coolify/Docker).

### Maintenance
- **New Database Table**: Added `pending_notifications` to track user notification subscriptions.
- **Improved Tools**: Updated `addMovie` and `addSeries` tools to return necessary IDs for automated follow-up actions.
- **Plex Service Tests**: Added verification for the new `allLeaves` endpoint in `src/services/__tests__/plex.test.ts`.

## [4.30.0] - 2026-03-09

### Added
- **UUID-based Instance Takeover**: Bot instances now use unique IDs to detect when they have been superseded by a new deployment, automatically shutting down within 30 seconds to prevent "piling up".
- **Graceful Shutdown**: Implemented `SIGTERM`/`SIGINT` handlers for clean process exits and database lock clearing.
- **Proxy Systemd Service**: Dedicated user-level service for the proxy gateway to ensure dashboard and webhook reliability.
- **Resilient Instance Locking**: Implemented PID-based process verification and future heartbeat handling to prevent bot startup failures due to stale database locks.
- **Fail-Fast Startup**: Moved lock checks to the very beginning of the startup sequence to prevent unnecessary resource usage and port conflicts.

### Fixed
- **Bot "Offline" States**: Resolved the issue where the bot would refuse to start if a previous instance crashed without clearing its lock.

### Tests
- **Instance Lock Tests**: Added a new unit test suite `src/services/__tests__/instance_lock.test.ts`.

## [4.27.2] - 2026-03-23

### Changed
- **System Prompt**: Enforced strict interactive button generation for any questions asked by the AI to improve conversation flow.

## [4.27.1] - 2026-03-23

### Fixed
- **Telegram Buttons**: Fixed an issue where interactive buttons were missing from Telegram messages when adding media due to the AI model skipping the button syntax format. The `addMovie` and `addSeries` tools now explicitly return button definitions to ensure rendering reliability.

## [4.27.0] - 2026-03-07

### Added
- **Plex Notification Settings**: Granular toggles for `media.play`, `media.resume`, `media.scrobble`, and `library.new` events in the web dashboard.
- **Dedicated Settings Page**: Refactored the proxy UI to move settings and preferences to a separate view.

### Fixed
- **Resilient Webhook Relay**: Updated the proxy to return `200 OK` to external services (like Sonarr/Plex) if the event is logged to the DB, even if the bot relay is temporarily offline.
- **Loopback Connectivity**: Webhook relay now uses `127.0.0.1` explicitly to avoid local Nginx conflicts.
- **Dashboard Autoscroll**: Fixed log list jumping by using `block: 'nearest'` for autoscroll.

## [4.26.0] - 2026-03-07

### Added
- **Proxy Web Dashboard**: Created a modern React UI served by the proxy (`http://localhost:3001`) with real-time service health, server logs, and latest webhook events in a responsive layout.
- **Event History & Settings UI**: Real-time webhook events are now natively displayed in the dashboard, alongside a new component for configuring Radarr and Sonarr webhook notification alerts directly from the browser.
- **Brain Latency Metric**: Added native LLM API pinging to measure underlying provider latency, displayed via `/status` and the Proxy UI.

### Changed
- **Database Webhook Events**: The bot now unconditionally saves all incoming Plex, Radarr, and Sonarr events to the SQLite database (even if notifications are globally disabled) to provide complete history rendering on the dashboard.

## [4.25.0] - 2026-03-07

### Added
- **Interactive Buttons**: The bot now generates clickable buttons for questions and choices, improving the conversational flow.
- **Improved UX**: Confirmation prompts and selections can now be handled via buttons instead of just text or numbers.

### Changed
- **System Prompt**: Updated to guide the AI in generating interactive button elements using a standardized syntax.

### Fixed
- **Prompt Escaping**: Resolved lint errors in the system prompt caused by unescaped backticks.


## [4.24.0] - 2026-03-06

### Added
- **Plex Library Notifications**: Enabled notifications for library.new events for movies and episodes.
- **/help Command**: Added a comprehensive listing of all bot features and commands.

### Tests
- **Webhook Test Suite**: Updated to verify library.new notifications.

## [4.23.0] - 2026-03-06

### Fixed
- **Smart Image Handler**: Implemented fetching local images from Plex/internal addresses to resolve 'Bad Request: wrong remote file identifier' errors.
- **Filename Detection**: Improved detection for uploaded media.

## [4.22.0] - 2026-03-06

### Fixed
- **Intent-Based Tool Gating**: For detail/info/synopsis user intent, add tools (`addMovie`, `addSeries`) are removed from the tool set unless explicit add intent is detected.
- **Interactive Buttons Layer**: The agent logic includes a post-processing regex layer to extract `BUTTON: Label | callback_data` patterns from LLM responses, populating the Telegram `InlineKeyboard`.
- **Error Diagnostics**: The `/audit` command provides a deep-dive into `/tmp/agentic-media-bot-restart.log` to identify root causes of crashes.
### Docs
- **Technical Specs**: Updated with persistent volume mapping requirements.

## [4.21.2] - 2026-03-06

### Changed
- **Telegram Inline Buttons**: Added support for interactive confirmations and choices.
- **Callback Routing**: Improved message handling to properly route callback queries through the agent.

## [4.21.1] - 2026-03-05

### Fixed
- **Interactive Confirmations**: Added mandatory confirmation for media removal in Radarr/Sonarr.
- **Type Definitions**: Resolved missing fields for Radarr and Sonarr media objects.

## [4.21.0] - 2026-03-05

### Added
- **Media Type Labeling**: Added [Movie]/[Show] labels to all search results.
- **Broad Country Search**: Included co-productions (e.g., Japan/USA) in searches.
- **Dynamic Library Stats**: Improved to include all sections (including Anime).

## [4.20.0] - 2026-03-05

### Added
- **Media Deletion Support**: Implemented `removeMovieTool` and `removeSeriesTool` for both movies and TV shows.

## [4.19.0] - 2026-03-05

### Added
- **NZBGet Integration**: Added service integration and health check in `/status`.

## [4.18.0] - 2026-03-05

### Added
- **Cloud-hosted Ollama**: Added support via `OLLAMA_BASE_URL` and transitioned to `@ai-sdk/openai` bridge.
- **Configuration Verification**: Improved with real AI generation tests.

### Fixed
- **Connectivity Checks**: Resolved bugs in OpenRouter/OpenAI verification.
- **Dependency Issues**: Updated `zod` and `zod-to-json-schema` for environment-specific errors.

## [4.17.0] - 2026-03-05

### Added
- **History Trimming**: Implemented to prevent context "stickiness".
- **Interactive Selection**: Added quality profiles and root folders for media additions.
- **Anime Support**: Improved Sonarr integration with automatic `seriesType` detection.

### Fixed
- **Success Messages**: Standardized format for Radarr and Sonarr tools.

## [4.16.0] - 2026-03-04

### Added
- **Systemd Management**: Added user service management instructions and setup script support.

### Docs
- **README Updates**: Added "Bot Logs" and "How to Manage the Bot" sections.

## [4.15.0] - 2026-03-03

### Changed
- **Plex Webhook Filters**: Restricted notifications to watching activity only (play, resume, scrobble).
- **Library Alerts**: `library.new` events no longer trigger Telegram alerts but still invalidate the cache.

## [4.14.0] - 2026-03-02

### Added
- **Startup Launch**: Added    - **Launch on Startup (Linux)**: Offers to create and enable a systemd user service for automated bot execution on system boot.
- **Interactive Buttons**
    - **Contextual Actions**: When asking questions or offering choices (e.g., adding media, selecting genres), the bot provides interactive buttons (Inline Keyboards) for a better user experience.
    - **Automatic Parsing**: The bot's engine automatically extracts button definitions from AI-generated text to display them as clickable elements.
- **Real-time Notifications (Plex Webhooks)**: Implemented IMDb ID prioritization and title validation.

### Fixed
- **TypeScript Errors**: Resolved 'possibly undefined' error in Plex webhook service.

## [4.13.0] - 2026-02-27

### Added
- **Cross-Service Alias Recovery (Webhooks)**: The bot now falls back to Radarr or Sonarr to find English titles if they are missing in Plex metadata for foreign-script titles in notifications.
- **Enhanced Metadata Enrichment**: Improved reliability of identifying original titles for foreign media by querying external management services.

### Changed
- **Cleaner Notifications**: Removed the colon and newline separator from starting/resuming/finishing notifications for a more modern, streamlined message format.

## [4.12.0] - 2026-02-27

### Added
- **Customized Webhook Templates**: Implemented movie and series specific templates for Plex notifications.
- **Series Playback Details**: Added SxxExx and episode title formatting for TV show notifications.
- **Universal Title Localization**: Bot now shows the original title in parentheses whenever it differs from the displayed title, regardless of script.

### Tests
- Added `notifications_v2.test.ts` to verify new formatting and localization requirements.
- Updated `webhooks.test.ts` to align with universal title localization logic.

## [4.11.0] - 2026-02-27

### Added
- **originalTitle in Webhook Payload**: Added `originalTitle` field to `PlexWebhookPayload.Metadata` interface to capture the English/original title from Plex webhook events.
- **Non-Latin Title Detection**: New `isNonLatinTitle` helper detects titles containing characters outside the Latin/Latin-Extended Unicode range (e.g. Japanese, Korean, Chinese, Arabic scripts).
- **Title Localization Protocol**: New `withEnglishTitle` helper appends the English/original title in parentheses when the primary title is non-Latin, implementing the Title Localization Protocol from the functional spec.

### Fixed
- **Webhook Notifications**: `library.new`, `media.play`, and `media.scrobble` events now display the English/original title alongside non-Latin titles (e.g. `七武士 (Seven Samurai)`).

### Tests
- Added 19 new tests covering `isNonLatinTitle`, `withEnglishTitle`, and webhook integration for foreign-language titles across all three event types.

## [4.5.0] - 2026-02-27

### Fixed
- **Plex Browsing**: Improved library detection to search across both movie and show sections concurrently, resolving issues where series like "The Bear" were missed during genre/country discovery.
- **Recommendations**: Replaced hardcoded title lists in `discoverMediaTool` with dynamic discovery logic.

### Changed
- **Tool Documentation**: Clarified that `searchPlexByDuration` is specifically for movies.

## [4.4.0] - 2026-02-27

### Changed
- **Tool Standardization**: Renamed Plex search tools to `searchPlexByCountry`, `searchPlexByGenre`, and `searchPlexByDuration`.
- **History Migration**: Added automatic normalization of legacy tool names in user history.

### Added
- **Legacy Aliases**: Kept old tool names as aliases for backward compatibility.

## [4.3.1] - 2026-02-27

### Fixed
- **Tool Mapping**: Resolved a critical crash (`TypeError: undefined is not an object`) when processing user messages due to a dead reference in the agent's tool set.
- **Regression Prevention**: Added a new test suite to ensure all referenced tools in the agent are correctly defined.

## [4.3.0] - 2026-02-27

### Added
- **Interactive Setup Tool**: New `src/setup.ts` CLI script for guided onboarding.
- **Auto-Dependency Installation**: Setup tool now detects missing `node_modules` and offers to run `bun install`.
- **Automated Plex Discovery**: Setup tool identifies Plex library sections during configuration.
- **Configuration Template**: Added `.env.example` with detailed documentation.

### Changed
- **README Redesign**: Comprehensive update with improved set-up instructions and feature overview.
- **Onboarding Experience**: Bot now guides users to the setup script if configuration is missing.

## [1.1.0] - 2026-02-27

### Changed
- **Architecture Refactor**: Centralized API fetch logic in `src/services/api.ts` to improve maintainability and consistency across Radarr, Sonarr, and Plex services.
- **Agent Modularization**: Split the agent core logic in `src/agent/index.ts` into smaller, focused files: `src/agent/prompts.ts` (system prompt) and `src/agent/utils.ts` (common utility functions).

### Fixed
- **API Error Consistency**: Standardized error messages for all media service API calls.
- **Test Integrity**: Fixed and expanded the test suite to cover the new architectural changes.

## [1.0.1] - 2026-02-26

### Fixed
- **saveUserName tool type validation**: Changed schema from `z.union([z.number(), z.string().transform(Number)])` to `z.coerce.number()` to properly convert string userId to number. This fixes the `Type validation failed` error when LLM sends userId as string instead of number.

## [1.0.0] - 2026-02-25

### Added
- Initial release of agentic-media-bot
- Telegram bot integration with AI agent
- Radarr, Sonarr, qBittorrent, and Plex service integrations
- Media discovery and library management tools
- Multi-language support (English, Spanish)