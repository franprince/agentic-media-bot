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

4. **Library Checking (Plex)**
   - Before downloading requested media, the bot will use Plex search tools to definitively confirm if the user already has the item to prevent duplicates.

5. **LLM Personality**
   - The bot should be helpful, concise, and confirm destructive/large actions before proceding.
