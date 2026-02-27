# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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