# Functional Specification: Agentic Media Bot

## Overview
A conversational Telegram bot that controls a user's home media server stack, capable of intelligent interpretation of natural language commands.

## Key Features

1. **Movie Management (Radarr)**
   - User writes: "Download the new Deadpool movie"
   - Bot searches Radarr, asks for clarification if multiple items are found, and triggers the download on user confirmation.
   - User asks: "How is the Deadpool download going?"
   - Bot checks queue and returns download percentage and ETA.

2. **TV Show Management (Sonarr)**
   - User writes: "I want to watch the latest season of The Boys."
   - Bot searches Sonarr, triggers the download of the missing season.

3. **Torrent Management (qBittorrent)**
   - User asks: "Are there any torrents currently active?"
   - Bot lists active torrents.
   - User commands: "Pause all downloads" or "Resume downloads".
   - Bot applies changes to qBittorrent.

4. **Library Auditing & Browsing (Plex, Radarr, Sonarr)**
   - User asks: "Do I have any horror movies?"
    - Bot searches Plex by genre (translating to English if requested in Spanish) via 'searchPlexByGenre' and returns deduplicated results across all movie and show libraries.
   - User asks: "Am I missing any episodes?"
   - Bot provides high-level summary (e.g., "Maching 2 series") or granular detail (Season, Episode, Air Date) upon request.

5. **System Health & Commands**
   - User writes: `/status`
   - Bot checks all services (Radarr, Sonarr, qBittorrent, Plex) and returns a consolidated report showing which are online or offline.
   - User writes: `/restart`
   - Bot stops polling, launches a detached restart supervisor script that waits for shutdown and starts a fresh bot process (admin/allowed users only). A custom shell command can be used via `BOT_RESTART_COMMAND`.
   - Restart command skips one startup catch-up pass to avoid unrelated retroactive replies immediately after restart.
   - After startup, bot sends a brief "back online" confirmation to the chat that requested `/restart`.

    - User writes: `/status`
    - Bot checks all services (Radarr, Sonarr, qBittorrent, Plex) and returns a consolidated report showing which are online or offline.

6. **Advanced Search & Localization**
   - **Origin Search (Plex)**: Supports queries like "Japanese movies" or "películas de Japón" via 'searchPlexByCountry' with fuzzy country tag matching.
   - **Country Noun Input**: Country searches normalize to noun form (e.g., "Germany", not "German") for tool calls and status output clarity.
   - **Canonical Country Normalization**: Demonyms (e.g., "Danish") are normalized to country nouns (e.g., "Denmark") consistently across tool execution and status logs.
   - **Country Filter Accuracy**: Country-tag browsing uses normalized Plex tag keys to avoid unfiltered or mixed-country results.
   - **Cross-Section Deduplication**: Country/genre browse results are deduplicated before reporting totals and samples.
   - **Strict Country Tag Filter**: Country browsing verifies each item’s `Country` tags and excludes items whose country tags do not match the requested country (language tags are ignored). Matching uses primary country by default.
   - **Country Verification by Title**: For questions like "Is X a French movie?", the bot verifies origin using Plex primary country from title metadata, not general model knowledge.
   - **Ranked Country Lists**: For "top/best/ranked N movies from COUNTRY" queries, the bot returns a top-N list sorted by Plex rating fields.
   - **Title Localization Protocol**: If a title is not in Spanish or English, the bot provides the English/Original title in parentheses.
   - **Deterministic Title Localization**: Country/genre deterministic list rendering also appends `originalTitle` when it differs from displayed title.
   - **Metadata-Enriched Alias**: If `originalTitle` is missing in browse results, the bot enriches sample items from Plex metadata (`originalTitle`/`titleSort`) to provide an alternate English/Spanish title when available.
   - **Cross-Source Alias Enrichment**: If Plex metadata still lacks a Latin alias for foreign-script titles, the bot attempts a best-effort Radarr lookup by title/year to recover an English alias.
   - **Missing Alias Transparency**: For non-Latin titles with no English/Spanish alias available in Plex metadata, the bot explicitly marks the alias as unavailable.
   - **Exact Count Rule**: For Plex country/genre browsing ('searchPlexByCountry'/'searchPlexByGenre'), replies always include the precise `totalFound` count from the tool output.
   - **Deterministic Plex Browse Reply**: Country/genre replies are rendered directly from tool results (count + sampled titles) to avoid model hallucinations or omissions.
    - **List Header Wording**: Plex genre lists use "This is the list of {genre} media:" and country lists use "This is the list of media from {country}:" instead of generic "Sample/Muestra".

7. **Personalization**
   - **Name Saving**: User can say "Call me Fran," and the bot will persist this in its database and greet the user by name.
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

8. **LLM Personality & I18n**
    - The bot is helpful, concise, and confirms massive actions.
    - It handles Spanish requests intelligently by mapping localized concepts (like "terror") to technical English keywords required by APIs.
    - If a user asks to add a movie or series by title, the bot must search first to obtain the correct ID before adding.
    - If Radarr is unavailable during a title-based add, the bot should surface a friendly error and offer to try again or check Plex.
    - If Radarr returns a bad add/search request, the bot should respond gracefully and avoid crashing the conversation flow.
    - Detail/info/synopsis requests must not trigger add/download actions unless the user explicitly asks to add.

10. **Onboarding and Setup**
    - **Interactive CLI Setup**: A standalone tool (`bun src/setup.ts`) guides new users through the initial configuration.
    - **Dependency Management**: The setup tool automatically checks for and offers to install missing dependencies (`bun install`).
    - **Guided Configuration**: Provides step-by-step instructions for obtaining Telegram Bot Tokens, User IDs, and the complex Plex Authentication Token.
    - **Automated Service Discovery**: Automatically identifies Plex library sections to simplify environment variable configuration (`PLEX_MOVIE_SECTION_IDS`, `PLEX_SHOW_SECTION_IDS`).
11. **Real-time Notifications (Plex Webhooks)**
    - **Library Activity**: Automatically notifies the user when new media is added to Plex (`library.new`).
    - **Playback Activity**: Notifies when a user starts watching (`media.play`) or finishes watching (`media.scrobble`) media.
    - **Rich Notifications**: Includes media posters/thumbnails in Telegram messages when available.
    - **Configurable Target**: Notifications can be sent to a specific chat ID via `WEBHOOK_NOTIFY_CHAT_ID`.
