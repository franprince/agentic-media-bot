# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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