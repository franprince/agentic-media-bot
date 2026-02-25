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
   - Bot searches Plex by genre (translating to English if requested in Spanish) and returns results across all libraries.
   - User asks: "Am I missing any episodes?"
   - Bot provides high-level summary (e.g., "Maching 2 series") or granular detail (Season, Episode, Air Date) upon request.

5. **System Health & Commands**
   - User writes: `/status`
   - Bot checks all services (Radarr, Sonarr, qBittorrent, Plex) and returns a consolidated report showing which are online or offline.

    - User writes: `/status`
    - Bot checks all services (Radarr, Sonarr, qBittorrent, Plex) and returns a consolidated report showing which are online or offline.

6. **Advanced Search & Localization**
   - **Origin Search (Plex)**: Supports queries like "Japanese movies" or "películas de Japón" via fuzzy country tag matching.
   - **Country Noun Input**: Country searches normalize to noun form (e.g., "Germany", not "German") for tool calls and status output clarity.
   - **Canonical Country Normalization**: Demonyms (e.g., "Danish") are normalized to country nouns (e.g., "Denmark") consistently across tool execution and status logs.
   - **Country Filter Accuracy**: Country-tag browsing uses normalized Plex tag keys to avoid unfiltered or mixed-country results.
   - **Cross-Section Deduplication**: Country/genre browse results are deduplicated before reporting totals and samples.
   - **Strict Country Tag Filter**: Country browsing verifies each item’s `Country` tags and excludes items whose country tags do not match the requested country (language tags are ignored).
   - **Title Localization Protocol**: If a title is not in Spanish or English, the bot provides the English/Original title in parentheses.
   - **Exact Count Rule**: For Plex country/genre browsing, replies always include the precise `totalFound` count from the tool output.
   - **Deterministic Plex Browse Reply**: Country/genre replies are rendered directly from tool results (count + sampled titles) to avoid model hallucinations or omissions.

7. **Personalization**
   - **Name Saving**: User can say "Call me Fran," and the bot will persist this in its database and greet the user by name.
   - **Warm Tone**: The bot maintains a friendly, emoji-rich personality (✨🤖).

8. **Dynamic Status Feedback**
   - **Thinking Protocol**: While processing tools, the bot provides real-time status updates in the user's language with warm, specific phrasing (e.g., "Buscando películas en Plex..." instead of generic "Working on...").
   - **Localized Transition Banner**: Initial transition messages (such as "Thinking..." and restart catch-up notices) are shown in the same language as the user's message.
   - **Accent-Resilient Language Detection**: Spanish should be detected correctly even when users omit accents (e.g., "peliculas" vs "películas").

9. **Update Notifications & Changelogs**
   - After a restart, if new features or fixes have been implemented, the bot automatically notifies administrators with a detailed changelog. 
   - Uses persistent state to ensure each unique update is only notified once.

8. **LLM Personality & I18n**
    - The bot is helpful, concise, and confirms massive actions.
    - It handles Spanish requests intelligently by mapping localized concepts (like "terror") to technical English keywords required by APIs.
    - If a user asks to add a movie or series by title, the bot must search first to obtain the correct ID before adding.
    - If Radarr is unavailable during a title-based add, the bot should surface a friendly error and offer to try again or check Plex.
    - If Radarr returns a bad add/search request, the bot should respond gracefully and avoid crashing the conversation flow.
