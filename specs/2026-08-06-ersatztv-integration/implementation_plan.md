# Implementation Plan — ErsatzTV Integration & Channel Director Skill

**Date:** 2026-08-06
**Slug:** `ersatztv-integration`
**Status:** Draft — pending approval

## User Review Required

> [!IMPORTANT]
> This implementation plan adds support for **ErsatzTV** IPTV management, daily EPG guide retrieval, health status monitoring, and an AI-driven **Channel Director** tool to program virtual channels based on metadata rules.

## Proposed Changes

### 1. Types Definition

#### `src/types/ersatztv.ts`
- Define `ErsatzTVChannel`, `ErsatzTVGuideProgram`, `ErsatzTVDailyGuide`, `ErsatzTVPlayout`, `ErsatzTVSchedule`, `ChannelDirectorParams`, `ChannelDirectorResult`.

### 2. Service Implementation

#### `src/services/ersatztv.ts`
- Implement standard REST API calls to ErsatzTV:
  - `getSystemStatus()`: checks API availability (`/api/v2/version` or `/api/version`).
  - `getChannels()`: lists configured IPTV channels (`/api/v2/channels`).
  - `getDailyGuide(channelId?: string, date?: string)`: retrieves current & upcoming scheduled programs (`/api/v2/channels/guide`).
  - `getPlayouts()`: lists active channel playouts (`/api/v2/playouts`).
  - `getSchedules()`: lists available block/smart schedules (`/api/v2/schedules`).
  - `createChannelDirectorProgramming(params)`: creates or updates smart collections, schedules, and assigns playouts to channels according to requested parameters.
- Support proxy routing via `isProxyEnabled()` and `executeOnProxy("ersatztv", methodName, args)`.

### 3. Service Health Integration

#### `src/services/health.ts`
- Update `checkAllServices()` to include ErsatzTV check:
  ```typescript
  { name: "ErsatzTV", check: () => ersatztv.getSystemStatus() }
  ```

### 4. Tailscale Proxy Registration

#### `src/proxy.ts`
- Register `ersatztv` methods in proxy service table so remote bot instances on Coolify can invoke ErsatzTV calls on the local host.

### 5. Agent Tools Implementation

#### `src/agent/tools/ersatztv-tools.ts`
- Create `getErsatzTVStatusTool`: returns channel count, active playouts, server version.
- Create `getErsatzTVGuideTool`: retrieves and formats daily program guide for user query.
- Create `channelDirectorTool`: handles parameter-driven programming creation (genres, shows, decade, fillers).

#### `src/agent/tools/index.ts`
- Export and register `ersatztvTools` in the main agent tool registry.

### 6. Channel Director Skill & Documentation

#### `skills/channel-director/SKILL.md`
- Create Channel Director skill definition documenting prompt patterns for auto-generating IPTV channel programming based on thematic criteria.

### 7. Configuration & Environment Verification

#### `.env.example`
- Add `ERSATZTV_URL=http://localhost:8409` and optional `ERSATZTV_API_KEY=`.

#### `src/verify-config.ts`
- Add `ERSATZTV_URL` check in configuration verification script.

### 8. Automated Unit & Integration Tests

#### `src/services/__tests__/ersatztv.test.ts`
- Unit tests for `getSystemStatus`, `getChannels`, `getDailyGuide`, `createChannelDirectorProgramming`.

#### `src/agent/tools/__tests__/ersatztv-tools.test.ts`
- Integration tests for AI tools with MSW mock handlers.

## Verification Plan

### Automated Tests
- Run `bun test src/services/__tests__/ersatztv.test.ts`
- Run `bun test src/agent/tools/__tests__/ersatztv-tools.test.ts`
- Run `bun run check:bot-parse` to ensure no syntax/import breakage in bot entries.
- Run `bun test` to ensure full test suite passes.

### Manual Verification
- Check system status reporting formatting via `checkAllServices()`.
- Verify proxy method dispatching in `src/proxy.ts`.
