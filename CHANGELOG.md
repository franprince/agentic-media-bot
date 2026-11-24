# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.48.0] - 2026-11-24

### Added
- **Fuller conversation for Claude**: With `AI_PROVIDER=anthropic` the model now receives the recent turns as they happened, with synopses and posters, instead of the compacted view built for a provider capped at 8,000 tokens per minute. That view made the bot contradict itself: on the third message of a conversation it held two of four turns and the previous search result had lost its synopsis. Ceiling: 60,000 characters (`src/agent/historyBudget.ts`); the stored history is still trimmed to its last 20 messages, so in practice this is about five tool turns.
- **New conversation after 12 hours (Claude)**: A typed message more than 12 hours after the last activity starts a new conversation, so a title from days ago is no longer read as the one being discussed. A button tap always continues the conversation its message belongs to. The `conversations` table gets an `updated_at` column, added automatically on startup.
- **Per-call usage log (Claude)**: Each request logs uncached input, cache-read, cache-write and output tokens, the elapsed time and the stop reason (`📊 Claude call: ...`), so prompt caching and latency can be measured from the journal.

### Fixed
- **No dead end when no tool covers a request**: Asked for something no tool does (for example changing the quality of a movie already in the library), the bot answered "I had trouble formulating a response" and showed the internal `NEED_MORE_TOOLS` marker as a status update. It now says plainly, in the user's language, that it cannot do that yet and what it can do. The marker is never shown and never saved into the conversation. This fix applies to every provider.
- **Recommendation prompt test**: `tmdb.test.ts` asserted the prompt as it was before `4.47.0`.

### Notes
- For the other providers (`ollama`, Google), tool routing, the history budget and the prompt for a narrowed tool set are unchanged; the only difference is the dead-end fix above, which changes one rule of the prompt when every tool is offered. `AI_HISTORY_CHAR_BUDGET` does not apply to Claude.
- The bot still widens the tool set once. If it widens to some groups and the model still asks for more, the user gets the "can't do that yet" message without every tool having been offered.
- A conversation saved before this version has no activity time and counts as expired: with Claude, each user's first typed message after the update starts a new conversation.

See `specs/2026-11-24-claude-context/`.

## [4.47.0] - 2026-11-20

### Added
- **Claude provider (`AI_PROVIDER=anthropic`)**: The bot can run on **Claude Haiku 5.5** through the official Anthropic SDK (`@anthropic-ai/sdk`, key in `ANTHROPIC_API_KEY`). `src/agent/anthropic.ts` is an AI SDK language model, so the agent loop, tools, confirmation guard and stored history are unchanged. It follows Haiku 5.5's request rules (no sampling parameters, no prefill, adaptive thinking with a `max_tokens` floor, no forced tool choice), repairs history stored under other providers (orphaned tool calls, incompatible tool ids), sends thinking blocks back within a tool loop only while the conversation before them is unchanged, and runs tools only when the model stopped to call them (never after a refusal or a cut-off reply). `AI_REASONING_EFFORT` sets Claude's effort (`low`–`max`, default `medium`).
- **Why Haiku 5.5, measured**: on a 14-case Spanish/English bake-off (tool choice, two-step confirmation, reply language) plus the router classifier, Haiku 5.5, Sonnet 5.5 and Opus 5.5 all passed every agent case; Haiku did it at ~$0.0008 per turn and ~2.8 s, about 19× cheaper than Sonnet and 40× cheaper than Opus. The provider uses Haiku only; `AI_MODEL_FAST` / `AI_MODEL_CAPABLE` are ignored with it.
- **Faster replies on Claude**: automatic prompt caching on every request (later tool-loop steps read the prompt from cache), and the recommendation lists behind `discoverMedia` run with thinking off and low effort (each call 4–6 s → ~1 s). A "find me a nice comedy series" turn went from ~19 s to ~5.6 s.
- `verify-config` checks the Anthropic key and pings Haiku 5.5; `setup.ts` offers `anthropic` as a provider.

### Fixed
- **Confirmation buttons**: Add/remove confirmations now show only the tool's buttons (real IDs, default settings) instead of also appending the model's generic copies (`add_movie_confirm`), which a stricter instruction-follower such as Claude produced on every confirmation. The add button names the default quality profile it uses ("✅ Yes, Add Movie (HD-1080p)"). Callback data is capped at Telegram's 64 bytes so an over-long model button cannot make the whole reply fail.
- **Reply language**: Tapping a button (`add movie 693134 4`) no longer switches a Spanish conversation to English, and colloquial requests such as "bajame dune parte dos" are recognised as Spanish.

### Notes
- `AI_MODEL_FALLBACKS` does not apply to this provider (the SDK retries rate limits itself). Voice notes still need `TRANSCRIPTION_URL` or `GOOGLE_GENERATIVE_AI_API_KEY`; Claude does not take audio.

See `specs/2026-11-20-claude-provider/`.

## [4.46.0] - 2026-11-14

### Changed
- **Token budget — tool routing**: Each request now carries only the tools and system-prompt sections the message can need, instead of all 41 tool schemas and the full prompt every time (`src/agent/toolRouter.ts`, `src/agent/prompts.ts`). Routing uses Spanish/English keywords, then conversation context for short replies and button callbacks, then a small classifier request, and falls back to the full tool set. A narrowed model can answer `NEED_MORE_TOOLS` to be re-run with more tools, so no capability is lost. Measured on Groq: ~10,100 prompt tokens per request before; ~700 for small talk, ~900–3,100 when routed, ~5,100 for the full fallback after.
- **Token budget — history**: The model receives a budgeted view of the conversation (`src/agent/historyBudget.ts`): older tool results are compacted to IDs, titles and counts, the oldest turns are dropped first, and the view never starts with an orphaned tool result. The stored history is unchanged. New optional `AI_HISTORY_CHAR_BUDGET`.
- **System prompt**: Rewritten as a core plus per-group sections. Removed the hand-written tool list (it duplicated the schemas and listed only half the tools), duplicated rules, and the hardcoded year. The two legacy tool aliases (`browsePlexByGenre`, `findPlexByCountry`) are no longer sent as duplicate schemas; old history is still migrated.
- **Language**: A message with no language of its own (a list pick, a button callback, a bare title, "hola") now keeps the conversation's language for status lines, the reply and the rewrite step (`detectConversationLanguage`).
- Step 0 no longer calls the Ollama-native classifier (`intentRouter.ts`); the `verify-config` check for it was removed.

### Added
- **Hosted OpenAI-compatible providers (e.g. Groq)**: `OLLAMA_API_KEY` is sent as the API key for `AI_PROVIDER=ollama`, so `OLLAMA_BASE_URL` can point at any OpenAI-compatible host. All models are built in `src/agent/provider.ts`.
- **Rate-limit handling**: HTTP 429 responses are waited out per request using `Retry-After` (up to 3 times, max 65s each), so a multi-step turn resumes instead of failing and tools from earlier steps are not executed twice.
- **Daily-quota fallback**: Optional `AI_MODEL_FALLBACKS` (comma-separated). A 429 that asks to wait more than about a minute is a per-day cap; the request is retried on the next fallback model, which has its own quota.
- **Confirmation guard** (`src/agent/confirmGuard.ts`): `addMovie`/`addSeries`/`removeMovie`/`removeSeries` only honour `confirm: true` if an earlier turn asked the user to confirm the same item. Some models skipped the folder/quality confirmation step; it no longer depends on the model.
- Optional `AI_REASONING_EFFORT` (sent as `reasoning_effort`) to cut reasoning tokens on reasoning models.
- **Recommendations fallback**: Years for which the model returns nothing usable (it does not know recent releases, or the request failed) are filled from TMDB's discover endpoint (top-rated, 500+ votes, same genre filter).

### Fixed
- `discoverMedia` failed on Groq with "Tool choice is required, but model did not call a tool"; recommendations now use JSON mode. They also honour `AI_PROVIDER` instead of always calling Ollama.
- Voice-note transcription on the Ollama-derived endpoint now sends `OLLAMA_API_KEY` when no `TRANSCRIPTION_API_KEY` is set.

See `specs/2026-11-14-token-budget/`.

## [4.45.0] - 2026-08-06

### Added
- **ErsatzTV Integration & Channel Director Skill**: Integrated ErsatzTV IPTV management service (`src/services/ersatztv.ts`, `src/types/ersatztv.ts`). Added ErsatzTV health monitoring to `/status` (`src/services/health.ts`), proxy method dispatching (`src/proxy.ts`), AI tools (`getErsatzTVStatusTool`, `getErsatzTVGuideTool`, `channelDirectorTool`), and the `channel-director` skill (`skills/channel-director/SKILL.md`).
- **Configuration & Environment**: Added `ERSATZTV_URL` and `ERSATZTV_API_KEY` configuration checks in `.env.example` and `src/verify-config.ts`.

See `specs/2026-08-06-ersatztv-integration/`.

## [4.44.0] - 2026-08-06

### Added
- **Shared `media-tools` skill consumption**: `checkServiceHealthTool`, `getDiskSpaceTool`, and all six `download-tools.ts` tools (torrent list/pause/resume/pause-all/resume-all, NZBGet queue) now source their data from the `media-tools` package via `src/services/media-tools-client.ts`, instead of calling `services/{radarr,sonarr,plex,qbittorrent,nzbget}.ts` directly. `media-tools` is an `optionalDependency` reachable only via `proxy.ts`'s new `mediaTools` dispatch entry (the remote bot never imports it directly). Same two skills are now published to `skills-marketplace` (`service-health`, `download-queue`), alongside the existing `media-library` skill.
- **Ollama Step 0 intent narrowing**: A new pre-classification step (`src/agent/intentRouter.ts`) runs before the existing tool-calling loop, using a local Ollama model (via the proxy) to classify mechanical requests into `service-health`/`download-queue` and narrow the tool set passed to the cloud model. Fails open to the full tool set on no match, low confidence, or any classifier error — a narrowing optimization only, not a behavior change; the cloud model still makes every tool call and generates every response.
- Fixed a hardcoded Bazarr API key default in `media-tools`' `BazarrManager` (sibling repo, not deployed with this one) — now requires `BAZARR_API_KEY` from the environment.

See `specs/2026-08-06-mechanical-skill-extraction-pilot/`.

## [4.43.2] - 2026-08-02

### Changed
- **Onboarding & Config Documentation**: `.env.example` was missing 17 environment variables the code actually reads (AI model overrides, TMDB, voice transcription, webhook port/notify-target overrides, proxy port, dashboard auth token, restart command override) — a third-party self-hoster had no way to discover these features existed. `.env.example` is now reorganized into required-vs-optional sections covering every var, the stray incomplete `PLEX_MOVIE_SECTION_IDS`/`PLEX_SHOW_SECTION_IDS` duplicate lines are removed, and `src/setup.ts`'s interactive flow now prompts for TMDB, voice transcription, and dashboard auth. README and `TECHNICAL_SPEC.md` now state plainly that this is a single-household bot — one shared arr stack, multiple allowed Telegram users — not a multi-tenant tool.
- **Documented a known gap**: `verify-config.ts`'s "OpenAI/OpenRouter Connectivity" check passes for `AI_PROVIDER=openai`, but `agent/index.ts` never actually routes chat requests through it (only `ollama` is branched; anything else falls through to Google). Recorded in `TECHNICAL_SPEC.md` and `BACKLOG.md` rather than fixed in this pass.

## [4.43.1] - 2026-08-02

### Fixed
- **Coolify Deployments Failing on `chowa` (production outage)**: `bun install --frozen-lockfile` in the `Dockerfile` aborted with `ENOENT: failed opening cache/package/version dir for package chowa`, because the `chowa` optional dependency resolves from `file:../chōwa` — a sibling checkout that exists only on the maintainer's machine and is never in the Docker build context. Every Coolify deploy had failed since `06dc17a` (2026-08-01 20:25) added that dependency, so the bot had been silently pinned to pre-`06dc17a` code; Coolify keeps the previous container when a build fails, which is why nothing appeared to break. `--omit=optional` is now passed in the `Dockerfile`, matching what the CI workflow already did — PR #2 fixed this for CI but not for the image build. Verified by reproducing the failure with a local `docker build` and confirming the image builds afterwards.

### Changed
- **Dockerfile Lint**: `FROM … as base` → `AS base`, silencing the `FromAsCasing` warning emitted on every build.

## [4.43.0] - 2026-08-02

### Added
- **NZBGet Extension Script**: Added `extensions/nzbget/AgenticMediaBot/`, a `bash`/`curl` extension that finally makes NZBGet notifications possible. NZBGet has no native webhook support — it only makes outbound HTTP calls from extension scripts — so `/nzbget-webhook` had existed in the bot for a long time without NZBGet ever calling it (zero `nzbget` events had ever been recorded). The extension registers as both a queue script (`NZB_ADDED` → `{"event":"added"}`) and a post-processing script (`NZBPP_TOTALSTATUS=SUCCESS` → `{"event":"success"}`), targeting the proxy by default like Radarr/Sonarr/Plex. Titles are JSON-escaped rather than interpolated, so releases containing quotes, backslashes or non-ASCII characters produce a valid body. A webhook failure never fails a download: errors are logged and post-processing still exits `93`.
- **Extension Installer**: Added `scripts/install-nzbget-extension.sh`, which copies the extension into NZBGet's `ScriptDir`. It deliberately does not edit `nzbget.conf` or restart the container — enabling the extension in NZBGet's `Extensions` setting remains a manual step, without which NZBGet will not run it.

### Fixed
- **Inaccurate NZBGet Notification Spec**: `FUNCTIONAL_SPEC.md` claimed NZBGet notifications included speed/ETA. They never did, and the extension does not send them: at queue time NZBGet reports a global download rate rather than a per-NZB figure, so the value would mislead.

## [4.42.25] - 2026-08-02

### Fixed
- **Dropped NZBGet & qBittorrent Notifications (`media_events` double-write)**: `src/proxy.ts` wrote every incoming webhook to `media_events` *before* relaying it to the bot, while the bot wrote the same event again via `eventQueue`'s `dbSave` closure. Both processes share `data/bot_data.sqlite` (`DATA_DIR` resolves relative to the working directory, which both systemd units share), and `saveMediaEvent` dedups on `(service, event_type, title)` within 60 seconds. For NZBGet and qBittorrent the two writers derived byte-identical tuples, so the proxy's row made the bot's `dbSave()` return `false` — and `eventQueue` skips `send()` whenever `dbSave()` is `false`, silently discarding the Telegram notification with only a `🔁 EventQueue: DB dedup dropped` log line. The bot is now the sole writer whenever the relay succeeds; the proxy writes only when the relay throws or `BRAIN_WEBHOOK_URL` is unset, preserving history while the bot is offline. Radarr/Sonarr/Plex escaped the drop only by accident (their event-type casing and title formats differed between the two writers), which also stopped every Radarr/Sonarr event being stored twice under both `Download` and `download`.

### Changed
- **Webhook Payload Parsing Extracted**: Moved the proxy's inline payload parsing into a new side-effect-free `src/services/webhookParser.ts` (`parseWebhookEvent`), so it can be unit-tested — importing `src/proxy.ts` exits the process when `PROXY_SECRET_KEY` is unset and then binds a port. Parsing behaviour is unchanged except that a malformed payload now returns `null` (logged) instead of throwing, so it can never prevent the relay from being attempted.

## [4.42.24] - 2026-08-01

### Fixed
- **CI Install Failure on `chowa`**: Moved the local-only `chowa` devDependency (`file:../chōwa`) to `optionalDependencies` and updated the CI workflow to run `bun install --omit=optional`, since the sibling `chōwa` checkout only exists on the maintainer's machine and isn't available to the GitHub Actions runner.
- **CI Test Failure on Missing `proxy-ui` Deps**: `bun test`'s root `bunfig.toml` preload (`proxy-ui/src/test-preload.ts`) requires `@testing-library/jest-dom`, which only exists under `proxy-ui/node_modules` (no workspace hoisting to root). Added a `bun install` step scoped to `proxy-ui/` in the CI workflow before running the test suite.

## [4.42.23] - 2026-08-01

### Changed
- **Agent Import Hoisting**: Hoisted the mid-function `await import(...)` calls in `src/agent/index.ts` (`setUserName`, `trimHistory`, `isProxyEnabled`/`executeOnProxy`) to static top-level imports for clarity; no behavior change.

## [4.42.22] - 2026-08-01

### Added
- **CI Workflow**: Added a GitHub Actions workflow (`.github/workflows/ci.yml`) that runs the bundle-parse check and full test suite on every push/PR to `master`.

## [4.42.21] - 2026-07-16

### Fixed
- **Library Check on Recommendations**: Updated the `discoverMediaTool` to search Plex, Radarr, and Sonarr in parallel for all recommended items, flagging them with `alreadyInLibrary`. Updated the system prompt to instruct the LLM to filter out owned items when recommendations are requested checking the library first.

## [4.42.20] - 2026-07-13

### Fixed
- **Pre-Push Safety Check**: Configured the client-side `pre-push` git hook to check for and terminate any running local bot processes (`bun run src/bot.ts` or `bot.js`) to prevent accidental 409 clashes with the remote instance.

## [4.42.19] - 2026-07-12

### Changed
- **Proxy Client Retry Loop**: Implemented a retry loop (up to 3 attempts with a 1-second delay) in `executeOnProxy` to handle transient network or Tailscale connection resets gracefully.

## [4.42.18] - 2026-07-12

### Changed
- **Forced Tool Calling**: Added a prompt rule to force the bot to always call the `discoverMedia` tool when asked for recommendations, preventing it from summarizing recommendations from chat history or memory.
- **Current Year Enforcement**: Explicitly instructed the LLM that the current year is 2026, preventing hallucinations that the year is 2025.

## [4.42.17] - 2026-07-12

### Changed
- **Parallel Year Recommendations**: Refactored `discoverMedia` to query TMDB and the LLM year-by-year in parallel for the requested range, consolidating results into a single list to guarantee true year diversity (including 2026) and eliminate duplicate list generation.
- **Strict Recommendation Buttons Removal**: Added an explicit exception to the interactive buttons system prompt, forbidding buttons and questions for numbered list recommendations.

## [4.42.16] - 2026-07-12

### Fixed
- **Git Hook deployment**: Fixed hook installation to use standard `pre-push` instead of non-standard `post-push`, ensuring local proxy deployments are triggered automatically on pushing code.

## [4.42.15] - 2026-07-12

### Changed
- **Recommendation Year & Rating Precision**: Configured the recommendation discovery system (`discoverMedia`) to explicitly pass the current year context and query release constraints to the LLM. Replaced LLM-hallucinated rating stars with actual TMDb user ratings (`vote_average`).
- **Niche Recommendations & Vote Thresholding**: Implemented popularity filtering. Recommendations are now limited to popular titles (500+ votes) or highly-rated niche titles (7.5+ rating with 50-499 votes), which are flagged with a `(⚠️ Few votes)` warning. Obscure titles with fewer than 50 votes are discarded.
- **Clean List UI**: Replaced list item callback buttons with a number selection prompt in the conversation flow, keeping the UI tidy and clear.

## [4.42.14] - 2026-07-12

### Changed
- **Ollama Enforcement in Discovery**: Configured the recommendation discovery system (`discoverMedia`) to always use the Ollama provider to avoid Gemini API credit card restrictions.

## [4.42.13] - 2026-07-12

### Changed
- **IMDb-Based Recommendations**: Re-implemented the recommendation discovery system (`discoverMedia`) to generate critically acclaimed and popular recommendations based on IMDb rating and votes using structured LLM output, resolving their poster and metadata via TMDB search in parallel.

## [4.42.12] - 2026-07-12

### Changed
- **Default Quality Profile Prioritization**: Prioritized the "Full-HD or Better (NO REMUX)" quality profile as the default choice when adding new movies (Radarr) or series (Sonarr) if configured.

## [4.42.11] - 2026-07-12

### Changed
- **Conditional Poster Rendering**: Prevented attaching a movie/series poster when recommending or listing multiple media items. Posters are now only included when discussing a specific movie/series or recommending a single top pick.

## [4.42.10] - 2026-07-12

### Added
- **Interactive Button per Recommendation**: Instructed the system prompt to require generating a dedicated interactive selection button for each item listed in recommendations or search results, allowing the user to select/act on any of the items directly.

## [4.42.9] - 2026-07-12

### Fixed
- **Photo message caption limit fallback**: Solved Grammy error "Bad Request: message caption is too long" in `safeReply` by automatically splitting the output when the caption exceeds Telegram's 1024-character limit. The photo is now sent first without a caption, and the full markdown text is delivered as a separate follow-up message.
- **Type error in photo sending logic**: Made the `options` parameter optional in `sendPhotoSmart` signature in `src/bot/messages.ts` to prevent TypeScript compilation errors when calling it with only 3 arguments.

## [4.42.8] - 2026-07-12

### Added
- **Current date context in agent prompt**: Made the agent aware of the current date (year, month, day, and weekday) in the system prompt. This fixes the issue where queries for new/recent media defaults to the model's knowledge cutoff year (the previous year) instead of the actual current calendar year.

## [4.42.7] - 2026-07-12

### Fixed
- **Database service type safety checks**: Fixed a TypeScript compilation issue in `src/services/database.ts` where array indexing and undefined `msg` values triggered `noUncheckedIndexedAccess` type check warnings in `sanitizeConversationHistory`.

## [4.42.6] - 2026-07-12

### Added
- **Start Downloading Notifications & qBittorrent Webhook Support:**
  - Implemented a `/qbittorrent-webhook` endpoint in proxy and bot to support direct webhook callbacks from qBittorrent on started and completed events.
  - Enabled personal download-start (Grab) notifications for subscribed users: when Radarr/Sonarr grabs a release, or when direct NZBGet/qBittorrent webhooks report a download started, the bot queries pending subscriptions (by TMDB/TVDB ID or title-matching) and immediately notifies the requesting user.

## [4.42.5] - 2026-07-12

### Fixed
- **CTA Language Mixing & Duplicated Confirmation Buttons**: 
  - Programmatically translate tool-suggested buttons (e.g. "✅ Yes, Add Movie", "❌ Cancel") to Spanish if the target language is Spanish.
  - Automatically filter out proactive download notification buttons (e.g. "Sí, notifícame!") if the tool execution indicates confirmation is required, preventing confusing double-CTA states.
  - Added a confirmation protocol to the system prompt to instruct the model to ask for confirmation instead of claiming success when confirmation is required.
  - Updated the language rewrite prompt to prevent the model from translating or modifying structured `callback_data` payloads in button blocks.

## [4.42.4] - 2026-07-11

### Fixed
- **TMDB Discover Year Ranges & Niche Sorting**: Upgraded the TMDB `discoverMedia` tool to parse year ranges (e.g. `2016-2026`, `last 5 years`) and relative boundaries. Adjusted sorting dynamically to use `popularity.desc` by default for standard queries, and `vote_average.desc` with higher vote count thresholds (300 for movies, 100 for TV) for acclaimed queries, resolving obscure/unrecognized recommendations.

## [4.42.3] - 2026-07-11

### Fixed
- **Missing processUserMessage import in bot.ts**: Added the missing import for `processUserMessage` in `src/bot.ts`, resolving a runtime `ReferenceError` that crashed the bot's catch-up loop (unreplied messages synchronization) on startup.

## [4.42.2] - 2026-07-11

### Fixed
- **Type errors in proxy-ui test environment**: Resolved TypeScript compilation errors in the `proxy-ui` subdirectory by adding `node` and `bun` to the TS compiler's `types` configuration in `tsconfig.app.json`, installing `@types/jsdom`, creating a `matchers.d.ts` declaration file to map `jest-dom` matcher types to `bun:test`, and cleaning up a type mismatch and an unused import in the test files.

## [4.42.1] - 2026-07-11

### Fixed
- **Type error in tools integrity test**: Fixed a TypeScript compilation issue in `src/agent/__tests__/tools_integrity.test.ts` where `toolMapping` required a strictly required `description: string`, which was incompatible with the optional `description?: string` of Vercel AI SDK's `CoreTool` type.

## [4.42.0] - 2026-07-11

### Changed
- **Bot architecture refactoring**: Refactored the monolithic `src/bot.ts` into individual modular files under `src/bot/` (`instance.ts`, `changelog.ts`, `auth.ts`, `commands.ts`, `messages.ts`, `crons.ts`, `utils.ts`) to improve maintainability and separate concerns.

## [4.41.1] - 2026-07-11

### Fixed
- **Cache import extension in formatters.ts**: Added missing `.ts` file extension to the `./cache` import to satisfy the strict `tsconfig` module resolution settings (`moduleResolution: "bundler"`, `allowImportingTsExtensions: true`).

## [4.41.0] - 2026-07-08

### Added
- **Programmatic Poster Fallback**: Implemented a self-healing fallback mechanism in `processUserMessage` that automatically extracts the poster URL directly from tool results (e.g. `searchSeries`, `searchMovie`, `discoverMedia`) if the LLM forgets or fails to generate the `POSTER: <url>` line.
- **Relative Poster URLs Resolution**: Updated `sendPhotoSmart` to detect relative cover URLs (starting with `/`) from Radarr or Sonarr local caches and automatically resolve them to absolute localhost or local-IP URLs before fetching.

## [4.40.9] - 2026-07-08

### Fixed
- **Markdown table title columns matching**: Optimized the table converter utility `convertMarkdownTablesToLists` to include singular TV show terms (like `Serie` or `Show`) in the search patterns. Improved standard column claiming logic to prevent fallback default index overrides from clearing titles when standard headers are present.

## [4.40.8] - 2026-07-08

### Fixed
- **Markdown table post-processing**: Added a programmatic post-processing layer `convertMarkdownTablesToLists` in the agent's response handler. This automatically detects any Markdown tables generated by the LLM and reformats them as clean lists, guaranteeing that responses are always readable and formatted properly on Telegram.

## [4.40.7] - 2026-07-08

### Fixed
- **Banned Markdown tables**: Instructed the agent in `DEFAULT_SYSTEM_PROMPT` to never use Markdown tables because Telegram does not support them and they render poorly. Always present structured recommendations, lists, or queues as clean numbered or bulleted lists.

## [4.40.6] - 2026-07-08

### Fixed
- **Type error in `bot.ts`**: Resolved TypeScript compilation error `Type 'undefined' cannot be used as an index type` on line 588 when indexing Plex webhook events. Added an early exit check if the `eventType` argument is undefined, which narrows its type and prevents potential runtime errors.
- **Rolling deployment 409 Conflict loop**: Resolved a persistent `409 Conflict` crash loop during container deployments (like Coolify/Docker where process PID is always `1`). Postponed the startup of the Telegram bot runner until the instance lock is fully acquired, while starting the HTTP server immediately to allow health checks to pass. Re-implemented lock acquisition to rely on heartbeat staleness if the process PID matches.

## [4.40.5] - 2026-07-08

### Fixed
- **Type error in `bot.ts`**: Resolved TypeScript compilation error `Cannot find namespace 'cron'` by importing `ScheduledTask` as a type directly from `node-cron` instead of trying to reference it on the default-imported `cron` value/namespace.

## [4.40.4] - 2026-07-08

### Fixed
- **Long polling 409 Conflict crash loop during container deployments**: Fixed a crash loop where new containers started during rolling updates (like on Coolify) would exit immediately on 409 Conflict. The bot now checks database lock ownership on conflict; the lock owner will continue running and retry polling, while superseded processes gracefully exit.

### Tests
- Added a test case in `src/services/__tests__/instance_supersede.test.ts` to verify conflict-handling decision logic based on database lock ownership.

## [4.40.3] - 2026-07-08

### Fixed
- **Proactive notification callback routing**: Updated the system prompt to use structured callback data formats (`notify_download_confirm_<mediaType>_<mediaId>` and `notify_download_decline`) for proactive notification buttons. This prevents the LLM from getting confused when handling button clicks and resolves the `notify_<title>` unknown command error.

### Tests
- Added an E2E test case in `src/agent/__tests__/agent_loop.test.ts` verifying that clicking the "Yes, notify me!" button successfully invokes the `subscribeToDownload` tool with the correct parameters retrieved from history.

## [4.40.2] - 2026-07-06

### Fixed
- **Transcription audio filename extension**: The Whisper multipart upload now derives the file extension from the actual MIME type (e.g. `audio.mp3` for `audio/mpeg`, `audio.webm` for `audio/webm`) instead of always sending `audio.ogg`, preventing codec misdetection on strict servers.
- **Explicit TRANSCRIPTION_URL failures now hard-fail**: When `TRANSCRIPTION_URL` is explicitly configured and the endpoint is unreachable or returns an error, the transcription now throws immediately instead of silently falling back to Gemini (which masked misconfigurations).
- **Provider-aware transcription error hint**: The voice-note error handler no longer unconditionally tells users to set `GOOGLE_GENERATIVE_AI_API_KEY`; the Gemini-specific hint is now suppressed when a custom transcription provider (`TRANSCRIPTION_URL`, `AI_PROVIDER=ollama`, or `AI_PROVIDER=openai`) is configured.
- **Per-admin changelog retry**: Failed startup changelog deliveries are now tracked per admin ID in `changelog_failed_admin_ids` metadata. On the next startup, still-failing admins are retried even if the version has already been committed, so no admin permanently misses a release notification.

### Improved
- **`transcription.ts` readability**: Extracted URL resolution into `resolveTranscriptionUrl()` and MIME-to-extension mapping into `mimeTypeToExtension()`, replacing the hard-to-read triple-chained ternary expression.
- **`verify-config.ts` transcription check**: Added an "Audio Transcription Provider" verification step that reports which provider is active (`TRANSCRIPTION_URL`, Ollama, OpenAI, or Gemini) and warns when none is configured.
- **Indentation**: Fixed a stray leading-space on the `isNewerVersion` block in `bot.ts`.

### Tests
- Added `src/services/__tests__/transcription.test.ts` with 9 tests covering: explicit Whisper success, correct filename extension for `audio/mpeg` and `audio/webm`, hard-fail on explicit-URL errors, silent Gemini fallback for derived Ollama URLs, default Gemini path, and the no-provider error.

## [4.40.1] - 2026-07-06

### Fixed
- **Watchlist command error**: Resolved a `ReferenceError: db is not defined` exception by properly importing and calling `getLocalWatchlist` from the database module.
- **Audio transcription file parts**: Changed the Vercel AI SDK `FilePart` key from `mediaType` to `mimeType` to match version `3.4.33` specifications, preventing Zod validation prompt format errors.
- **Robust Multi-Provider Transcription**: Added support for OpenAI/Whisper-compatible transcription endpoints (`/v1/audio/transcriptions`) with automatic fallback to Gemini 1.5 Flash.
- **Startup changelog delivery robustness**: Postponed updating the database version key until after messages are successfully sent to Telegram to ensure notifications are not dropped on crash/restart.
- **Service Deployment restarts**: Updated the deployment script to prompt for restarts of both `agentic-media-bot` and `agentic-media-proxy` services.

## [4.40.0] - 2026-07-05

### Added
- **Telegram Voice Notes Transcription**:
  - Automatically intercepts voice messages, downloads the audio payload, and passes it directly to Gemini 1.5 Flash for transcription.
  - Passes the transcribed query to the conversational agent seamlessly.
- **Dynamic Database-Backed Scheduled Reports**:
  - Added SQLite `report_subscriptions` table to save user-defined recurring reports.
  - Implemented dynamic scheduling using `node-cron` matching stored cron expressions.
  - Exposed agent tools: `subscribeToReportTool`, `unsubscribeFromReportTool`, and `getReportSubscriptionsTool`.

## [4.39.1] - 2026-07-04

### Fixed
- **Duplicate startup changelog notifications**: Updated the database metadata version check in `src/bot.ts` to write `last_sent_changelog_version` to SQLite *before* performing Telegram message delivery. This prevents race conditions and duplicate message notifications if multiple startup hooks or instances execute in close succession.

## [4.39.0] - 2026-07-04

### Added
- **Plex Active Playback sessions ("Now Playing")**:
  - Implemented `getPlexSessions()` querying the local server status endpoint `/status/sessions`.
  - Parses playback progress percent, player devices, username, and formats episode title strings.
  - Exposed `getPlexSessionsTool` to allow the conversational agent to check who is currently watching media.
- **Storage Monitoring & Low Disk Alerts**:
  - Added a conversational `getDiskSpaceTool` that lists all configured folders and their free space across Radarr and Sonarr.
  - Added the `/storage` Telegram command to check disk space on demand.
  - Registered a daily background cron job checking for folders with less than 50 GB free, pushing proactive low-space warnings to Telegram admin users.
- **Custom Tags Support**:
  - Added endpoints `/tag` on Radarr/Sonarr to get existing tags and create new ones.
  - Implemented `resolveTagIds(labels)` helper mapping string labels to tag IDs, automatically creating missing tags.
  - Updated `addMovieTool` and `addSeriesTool` parameters and payloads to accept custom tag labels (e.g. `['4k-only']`).

## [4.38.0] - 2026-07-04

### Added
- **Universal Watchlist Integration**: Fully integrated the agent and bot with the Plex Universal Watchlist service:
  - Fetches the user's Plex Watchlist via the `discover.provider.plex.tv` API.
  - Automatically queries detailed metadata for new watchlist items to extract universal IDs (IMDb, TMDB, TVDB IDs).
  - Synchronizes items to a local SQLite `watchlist` database table (`syncWatchlist`).
  - Supports adding and removing items from the online Plex Watchlist directly using HTTP `PUT` requests to Plex's discover endpoints.
- **SQLite Watchlist Cache**: Added a local `watchlist` SQLite table to store titles, media types, external IDs, and status (e.g. `pending`, `downloading`, `completed`).
- **Watchlist Telegram Commands**: Registered `/watchlist` (to list current items and download statuses) and `/watchlist_sync` (to manually force synchronization).
- **Watchlist Agent Tools**: Implemented `getWatchlistTool`, `addToWatchlistTool`, `removeFromWatchlistTool`, and `syncWatchlistTool` to allow the LLM agent to manage the watchlist on behalf of the user.

## [4.37.0] - 2026-07-04

### Added
- **Pre-computed download progress** (`tools`): `getMovieQueueTool` (Radarr), `getSeriesQueueTool` (Sonarr), `getTorrentsTool` (qBittorrent), and `getNZBGetQueueTool` now output rich human-readable download details:
  - Download progress percentage (e.g. `45.20%`).
  - Human-readable byte formatting (e.g. `1.2 GB` / `500 MB`).
  - Pre-calculated ETA combined with timezone-aware wall-clock completion time (e.g. `2h 15m (est. 18:45:12)`).
- **Timezone-aware date/time formatting**: Stored database timezone is now applied to all printed event dates (such as `/plex`, `/radarr`, and `/sonarr` commands) and wall-clock queue completion times.
- **Plex search cross-check enrichment**: Radarr (`searchMovieTool`) and Sonarr (`searchSeriesTool`) search results are now automatically cross-checked against the local Plex library. Results include an `alreadyInPlex: true/false` flag, preventing the LLM from having to execute separate search steps.

## [4.36.1] - 2026-07-04

### Fixed
- **Triple-notification race condition** (`eventQueue`): Three simultaneous webhook
  deliveries (e.g. 3 Sonarr connections configured in Sonarr Settings → Connect) could
  all pass the `saveMediaEvent` duplicate check before any had time to INSERT, causing
  identical notifications to be sent 3× to every Telegram target.

  **Root cause**: The previous `SELECT → INSERT` flow was not atomic under concurrent
  async requests handled by Bun's HTTP server.

  **Fix**: Introduced a singleton `WebhookEventQueue` (`src/services/eventQueue.ts`)
  that provides two deduplication layers:
  1. **In-memory (fast path)** — if the same `service:eventType:title` key is already
     pending in the queue, subsequent arrivals are dropped immediately before any DB
     or Telegram interaction.
  2. **DB safety net** — the queue's serial single-worker drain loop calls
     `saveMediaEvent()` (which uses a `BEGIN IMMEDIATE` SQLite transaction) before
     each `send()`, so late-arriving duplicates (same episode re-downloaded within
     60 s) are also blocked.

  All webhook handlers (Plex, Radarr, Sonarr, NZBGet) now return `200 OK` immediately
  after enqueuing the event; notification delivery is fully decoupled and happens
  asynchronously in the queue worker.

## [4.36.0] - 2026-07-04

### Added
- **Multi-user notification fan-out**: Webhook notifications (Plex, Radarr, Sonarr, NZBGet) now fan out to **every user** in `ALLOWED_USER_IDS` instead of only the first. `WEBHOOK_NOTIFY_CHAT_ID` still overrides to a single explicit target for backward compatibility. Each recipient gets their own try/catch so one bad Telegram ID can't prevent others from receiving the notification. Plex thumbnail images are fetched once and sent to all targets.
- **Bulk torrent pause/resume**: New `pauseAllTorrentsTool` and `resumeAllTorrentsTool` agent tools. Use the `hashes=all` qBittorrent API shortcut — no per-torrent loop required. Agent responds correctly to "pause everything" / "stop all downloads" commands.
- **Dashboard authentication (`DASHBOARD_TOKEN`)**: All `/api/*` proxy endpoints now support opt-in bearer-token authentication. Set `DASHBOARD_TOKEN=<secret>` in the proxy environment to require `Authorization: Bearer <token>` on every dashboard API call. Set `VITE_DASHBOARD_TOKEN=<secret>` in the UI build to have the frontend attach it automatically. The `/health` endpoint and `/api/tool` (AI proxy, uses `PROXY_SECRET_KEY`) are excluded. Deployments without `DASHBOARD_TOKEN` continue working with no change.

### Changed
- `proxy-ui` fetch calls now use a shared `apiFetch()` helper that auto-attaches the `Authorization` header from `VITE_DASHBOARD_TOKEN`.
- `verify-config.ts` now checks for `DASHBOARD_TOKEN` and warns (non-fatal) when it is not set.

## [4.35.0] - 2026-07-03


### Fixed
- **Invalid Date in /plex, /radarr, /sonarr commands**: `saveMediaEvent` was storing timestamps using `datetime('now') || 'Z'` (space-separated, double-Z format). `bot.ts` then appended another `'Z'`, producing an unparseable string. Timestamps are now stored as proper ISO-8601 (via `new Date().toISOString()`) and a robust `formatEventTimestamp` helper handles both old and new formats gracefully.
- **Duplicate events in /plex (library.new x2)**: Plex fires `library.new` once per matching library section, causing the same movie to appear twice. `saveMediaEvent` now deduplicates: if the same `(service, event_type, title)` was already saved within the last 60 seconds, the duplicate is silently dropped.
- **Quality: undefined on Radarr/Sonarr Grab events**: `release.quality` on `Grab` payloads can be a nested object `{ quality: { name } }` rather than a plain string. Applied the same nested-object unwrapping logic already in place for `Download` events to both Radarr and Sonarr `Grab` handlers.

### Added
- **BACKLOG.md**: Living feature backlog document tracking all P0/P1/P2 items from the product analysis.
- **E2E tests**: Added `media_events.test.ts` covering timestamp validity, deduplication, and negative cases. Added two new tests to `radarr_sonarr_webhooks.test.ts` covering nested quality objects on Radarr and Sonarr Grab events.

### Fixed
- **Webhook Quality Robustness**: Made webhook quality name extraction robust for both Radarr and Sonarr to handle cases where the quality property is a nested object or a string.
- **Webhook Payload Safety**: Guarded Radarr and Sonarr webhooks against empty/missing movie or series payload objects (e.g. system health notifications).

## [4.34.0] - 2026-07-03

### Added
- **Plex Alerts Management**: Added `/plex` Telegram bot command to view recent Plex events and turn specific alerts (play, resume, scrobble, library) on or off. Refined `/notifications` command description to clarify its global nature.

## [4.33.2] - 2026-07-03

### Changed
- **Default Profile Selection**: Updated default quality selection for new movies (Radarr) and series (Sonarr) to prefer "Full-HD or Better" profiles if configured. In addition, new series will default to the "Original" language profile if available in Sonarr.

## [4.33.1] - 2026-07-01

### Fixed
- **Webhook Quality Field**: Fixed an issue where movie/series quality reported as `undefined` on Radarr and Sonarr download complete events. The bot now parses the quality from the nested `movieFile` and `episodeFile` objects.

## [4.33.0] - 2026-06-27

### Added
- **TMDB-powered recommendations**: The `discoverMedia` tool is now wired to the TMDB Discover API. When users ask for movie/series recommendations (e.g. "comedy from 2025 I don't have"), the bot queries TMDB in real time and returns actual titles with ratings, genres, and overviews — instead of relying on the model's training data.
- **TMDB service** (`src/services/tmdb.ts`): Thin client for TMDB's `/discover/movie` and `/discover/tv` endpoints. Parses genre keywords and year hints from free-text queries. Authenticates via `TMDB_READ_ACCESS_TOKEN` (Bearer) or falls back to `TMDB_READ_API_KEY`.
- **TMDB verify-config check**: Startup verification now includes a soft TMDB connectivity check. Missing credentials produce a warning (not a fatal error).

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