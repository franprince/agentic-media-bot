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

5. **Advanced Search**
   - When searching for media, the bot provides original titles, genres, and metadata identifiers (IMDb, TMDB, TVDB) to help the user identify foreign or correctly localized content.

6. **LLM Personality & I18n**
   - The bot is helpful, concise, and confirm massive actions.
   - It handles Spanish requests intelligently by mapping localized concepts (like "terror") to technical English keywords required by APIs.
