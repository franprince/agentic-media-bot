# Functional Specification: Agentic Media Bot

## Overview
A conversational Telegram bot that controls a user's home media server stack, capable of intelligent interpretation of natural language commands.

## Key Features

1. **Movie Management (Radarr)**
   - User writes: "Download the new Deadpool movie"
   - Bot searches Radarr, asks for clarification if multiple items are found, and triggers the download on user confirmation.
   - User asks: "How is the Deadpool download going?"
   - Bot checks queue and returns download percentage and ETA.
   - User asks: "Delete the movie Deadpool from Radarr."
    - Bot searches Radarr database for the internal ID and presents the match for confirmation, explicitly asking whether to delete files as well before proceeding.

2. **TV Show Management (Sonarr)**
   - User writes: "I want to watch the latest season of The Boys."
   - Bot searches Sonarr, triggers the download of the missing season.
   - **Anime Support**: The bot automatically detects if a series is an Anime (via genres) and sets the correct `seriesType: "anime"` in Sonarr to ensure proper metadata and episode handling.

3. **Interactive Addition Settings**
   - When adding movies or series, the bot presents a summary of the match.
   - **Configuration Options**: Before adding, the bot displays available **Quality Profiles** and **Root Folders** from the service.
   - **User Confirmation**: The addition only proceeds once the user confirms the match and (optionally) specifies their preferred profile or folder.

4. **Torrent & NZB Management (qBittorrent, NZBGet)**
    - User asks: "Are there any torrents currently active?" or "How is my NZBGet download?"
    - Bot lists active downloads with speed and ETA.
    - User commands: "Pause all downloads" or "Resume downloads".
    - Bot applies changes to qBittorrent or NZBGet.
    - Behavior is unchanged; as of the mechanical skill extraction pilot the underlying queue/pause/resume calls are served by the shared `download-queue` skill in `media-tools` (also published to `skills-marketplace`) instead of bot-inline logic.

4. **Library Auditing & Browsing (Plex, Radarr, Sonarr)**
   - User asks: "Do I have any horror movies?"
    - Bot searches Plex by genre (translating to English if requested in Spanish) via 'searchPlexByGenre' and returns deduplicated results across all movie and show libraries.
   - User asks: "Am I missing any episodes?"
   - Bot provides high-level summary (e.g., "Maching 2 series") or granular detail (Season, Episode, Air Date) upon request.
   - **Unwatched Episodes Audit**: "Show me my unwatched episodes for 'The Boys'".
   - **Proactive Notifications**: After adding a movie, the bot asks "Would you like a notification?" and alerts the user once it's available.
   - Bot searches Plex and returns a list of episodes yet to be watched.

6. **System Health, Auditing & Commands**
   - User writes: `/status`
   - Bot checks all services (Radarr, Sonarr, qBittorrent, Plex, NZBGet) and returns a consolidated report showing which are online or offline.
   - Per-service health checks and disk-space lookups (e.g. "is Sonarr up?") are served by the shared `service-health` skill in `media-tools`; behavior is unchanged. Simple, confidently-classified mechanical requests in this category also skip past most of the agent's ~27-tool selection surface via a local Ollama pre-classification step — a performance optimization, not a behavior change (see `TECHNICAL_SPEC.md`).
   - User writes: `/audit`
   - Bot performs a deep diagnostic audit, reading recent logs to identify errors, instance conflicts, and uptime stats (admin only).
   - User writes: `/restart`
   - Bot triggers a safe restart using a detached supervisor script that ensures old processes are fully terminated (admin only).
   - Restart command skips one startup catch-up pass to avoid retroactive replies.
   - After startup, the bot sends a "back online" confirmation to the requester.

6. **Proxy Web Dashboard & Event History**
   - **Real-Time Health Status**: The Proxy web interface displays the aggregated health status of all hooked services (Radarr, Sonarr, Plex, qBittorrent, NZBGet, and the Brain/LLM latency ping).
   - **Event History**: All incoming media webhooks (Plex playback, Radarr/Sonarr grabs and downloads) are recorded in the database and visible in a "Latest Events" UI pane, ensuring users have persistent visibility into bot triggers even if Telegram notifications are disabled.
    - **Plex Notification Settings**: Dedicated toggles for `media.play`, `media.resume`, `media.scrobble`, and `library.new` events, managed via the web dashboard.
    - **Dedicated Settings Page**: Preferences and notification toggles are hosted on a separate, dedicated "Settings" view to keep the main dashboard clean.
    - **System Logs**: Live-tailing interface for the latest system audit logs directly from the browser.

7. **Advanced Search & Localization**
   - **Origin Search (Plex)**: Supports queries like "Japanese movies" or "películas de Japón" via 'searchPlexByCountry' with fuzzy country tag matching.
   - **Country Noun Input**: Country searches normalize to noun form (e.g., "Germany", not "German") for tool calls and status output clarity.
   - **Canonical Country Normalization**: Demonyms (e.g., "Danish") are normalized to country nouns (e.g., "Denmark") consistently across tool execution and status logs.
   - **Country Filter Accuracy**: Country-tag browsing uses normalized Plex tag keys to avoid unfiltered or mixed-country results.
   - **Cross-Section Deduplication**: Country/genre browse results are deduplicated before reporting totals and samples.
    - **Strict Country Tag Filter**: Country browsing verifies each item’s `Country` tags and excludes items whose country tags do not match the requested country (language tags are ignored). Matching includes all co-productions by default (`primaryOnly: false`).
    - **Media Type Labeling**: All search and browse results from Radarr, Sonarr, and Plex include an explicit media type label (e.g., `[Movie]`, `[Show]`).
   - **Country Verification by Title**: For questions like "Is X a French movie?", the bot verifies origin using Plex primary country from title metadata, not general model knowledge.
   - **Ranked Country Lists**: For "top/best/ranked N movies from COUNTRY" queries, the bot returns a top-N list sorted by Plex rating fields.
   - **Title Localization Protocol**: If a title is not in Spanish or English, the bot provides the English/Original title in parentheses.
   - **Deterministic Title Localization**: Country/genre deterministic list rendering also appends `originalTitle` when it differs from displayed title.
   - **Metadata-Enriched Alias**: If `originalTitle` is missing in browse results or webhook notifications, the bot enriches sample items from Plex metadata (`originalTitle`/`titleSort`) to provide an alternate English/Spanish title when available.
   - **Cross-Source Alias Enrichment**: If Plex metadata still lacks a Latin alias for foreign-script titles in browse results or webhooks, the bot attempts a best-effort Radarr/Sonarr lookup by title/year to recover an English alias.
   - **Missing Alias Transparency**: For non-Latin titles with no English/Spanish alias available in Plex metadata, the bot explicitly marks the alias as unavailable.
   - **Exact Count Rule**: For Plex country/genre browsing ('searchPlexByCountry'/'searchPlexByGenre'), replies always include the precise `totalFound` count from the tool output.
   - **Deterministic Plex Browse Reply**: Country/genre replies are rendered directly from tool results (count + sampled titles) to avoid model hallucinations or omissions.
    - **List Header Wording**: Plex genre lists use "This is the list of {genre} media:" and country lists use "This is the list of media from {country}:" instead of generic "Sample/Muestra".

7. **Personalization**
   - **Name Saving**: User can say "Call me Fran," and the bot will persist this in its database and greet the user by name.
   - **Context Management**: Conversation history is bounded and automatically trimmed to the last 20 messages. This prevents "sticky" context where the bot confuses current requests with old, unrelated topics.
   - **Warm Tone**: The bot maintains a friendly, emoji-rich personality (✨🤖).

8. **Dynamic Status Feedback**
   - **Thinking Protocol**: While processing tools, the bot provides real-time status updates in the user's language with warm, specific phrasing (e.g., "Buscando películas en Plex..." instead of generic "Working on...").
   - **Localized Transition Banner**: Initial transition messages (such as "Thinking..." and restart catch-up notices) are shown in the same language as the user's message.
   - **Accent-Resilient Language Detection**: Spanish should be detected correctly even when users omit accents (e.g., "peliculas" vs "películas").
   - **Final Reply Language Guard**: Final answer text is forced to match the detected user language (Spanish/English) before sending.

9. **Update Notifications & Changelogs**
   - Changelog entries are organized as semantic-versioned releases (e.g., `1.4.2`, `1.5.0`, `2.0.0`).
   - On bot startup, administrators receive the latest release changelog message once per version upgrade.
   - Long changelog notifications are split into Telegram-safe chunks to avoid message length errors.
   - If a notification fails for a specific admin ID, the delivery is retried on every subsequent startup until it succeeds.

10. **Voice Note Transcription**
    - The bot intercepts Telegram voice messages (`message:voice`) and automatically transcribes them using the configured AI provider.
    - The transcription result is shown inline (in italics) and then processed by the conversational agent as if the user had typed it.
    - If the audio contains no detectable speech, the user receives a friendly message instead of an empty reply.
    - **Provider selection** (priority order):
        1. `TRANSCRIPTION_URL` — explicit Whisper-compatible endpoint. Failures are surfaced immediately (hard-fail).
        2. Ollama-derived endpoint (`AI_PROVIDER=ollama`) — uses `OLLAMA_BASE_URL/v1/audio/transcriptions`. Failures silently fall back to Gemini.
        3. OpenAI-derived endpoint (`AI_PROVIDER=openai`) — uses `OPENAI_BASE_URL/v1/audio/transcriptions`. Failures silently fall back to Gemini.
        4. Google Gemini 1.5 Flash (default/fallback).
    - **Error messaging**: API key errors are only attributed to Gemini when no custom transcription provider is active, to avoid misleading users with alternative setups.

8. **LLM Personality & I18n**
    - The bot is helpful, concise, and confirms massive actions.
    - It handles Spanish requests intelligently by mapping localized concepts (like "terror") to technical English keywords required by APIs.
    - If a user asks to add a movie or series by title, the bot must search first to obtain the correct ID before adding.
     - **IMDb ID Prioritization**: If the user provides an IMDb ID (e.g., "tt12345"), the bot uses it as the primary search term.
     - **Title Match Validation**: When an IMDb ID is provided alongside a title, the bot validates that the metadata found matches the mentioned title; if a mismatch is detected, it specifically warns the user and requests explicit confirmation.
     - If Radarr is unavailable during a title-based add, the bot should surface a friendly error and offer to try again or check Plex.
    - If Radarr returns a bad add/search request, the bot should respond gracefully and avoid crashing the conversation flow.
    - Detail/info/synopsis requests must not trigger add/download actions unless the user explicitly asks to add.

10. **Onboarding and Setup**
    - **Interactive CLI Setup**: A standalone tool (`bun src/setup.ts`) guides new users through the initial configuration.
    - **Dependency Management**: The setup tool automatically checks for and offers to install missing dependencies (`bun install`).
    - **Guided Configuration**: Provides step-by-step instructions for obtaining Telegram Bot Tokens, User IDs, and the complex Plex Authentication Token.
    - **AI Provider Selection**: Supports Google Gemini, Ollama (both local and cloud-hosted via `OLLAMA_BASE_URL`) and Anthropic Claude (`AI_PROVIDER=anthropic`, prompts for `ANTHROPIC_API_KEY` and the fast/capable Claude models).
    - **Automated Service Discovery**: Automatically identifies Plex library sections to simplify environment variable configuration (`PLEX_MOVIE_SECTION_IDS`, `PLEX_SHOW_SECTION_IDS`).
    - **Launch on Startup (Linux)**: Offers to create and enable a systemd user service for automated bot execution on system boot.
11. **Interactive Buttons**
    - **Contextual Actions**: When asking questions or offering choices (e.g., adding media, selecting genres), the bot provides interactive buttons (Inline Keyboards) for a better user experience.
    - **Automatic Parsing**: The bot's engine automatically extracts button definitions from AI-generated text to display them as clickable elements.
    - **Confirmation Buttons Come From the Tools**: Add/remove confirmations show the tool's own buttons, which carry the real IDs and the default settings; the add button names the default quality profile it will use (e.g. "✅ Yes, Add Movie (HD-1080p)", "✅ Sí, añadir película (HD-1080p)" in Spanish). The model's own button lines are not added next to them. Tapping a button keeps the conversation's language.
12. **Real-time Notifications (Plex Webhooks)**
    - **Library Activity**: Internal cache is automatically invalidated when new media is added to Plex (`library.new`) to ensure data freshness. No user notification is sent for this event.
    - **Playback Activity**: Notifies when a user starts watching (`media.play`) or finishes watching (`media.scrobble`) media.
    - **Real-time Notifications**: Integrated Telegram notifications for:
    - **Plex**: Playback status (play, resume, finish) and library additions.
    - **Radarr**: Media grabbed and download completes.
    - **Sonarr**: Episode grabbed and download completes.
    - **NZBGet**: NZB added to the queue and download completes successfully. Delivered by the `AgenticMediaBot` extension script (`extensions/nzbget/`), since NZBGet has no native webhooks; it must be installed and enabled in NZBGet before any of these arrive. Speed/ETA are accepted by the payload but not sent: at queue time NZBGet's speed is a global rate rather than a per-NZB figure, so reporting it would mislead. Downloads ending in `WARNING`/`FAILURE`/`DELETED` are not announced.
    - **Rich Notifications**: Fetches posters/thumbnails locally from Plex and uploads them as `InputFile` to ensure delivery even from internal/localhost addresses.
    - **Customized Playback Format**: Notifies starting/resuming/finishing media with user-specific templates:
        - Movies: `User started watching the movie Title (Original Title)`
        - Series: `User started watching an episode of Show Name - SxxExx - Episode Title (Original Title)`
    - **Configurable Target**: Notifications can be sent to a specific chat ID via `WEBHOOK_NOTIFY_CHAT_ID`.
    - **Notification Toggle**: Admin users can use the `/notifications <on/off>` command to enable or disable Plex alerts globally.
12. **Conditional Features**
    - **Optional Webhooks**: Users can choose to skip Plex webhook setup during onboarding.
    - **Server-less Mode**: If webhooks are disabled, the bot does not start its internal web server, reducing its resource footprint.
