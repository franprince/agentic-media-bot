# Spec — ErsatzTV Integration & Channel Director Skill

**Date:** 2026-08-06
**Slug:** `ersatztv-integration`
**Status:** Draft — pending approval

## Problem Statement

Users of `agentic-media-bot` currently have agentic tools for managing movies (Radarr), TV series (Sonarr), playback & media status (Plex), and downloads (qBittorrent, NZBGet). However, there is no integration with linear TV / IPTV generators such as **ErsatzTV** (which streams custom live channels from local Plex/Jellyfin libraries).

Users currently cannot:
1. Check the status or health of their local ErsatzTV instance via `/status` or agent queries.
2. Query daily TV guides (EPG schedule) to see what is playing today or scheduled across custom IPTV channels.
3. Automatically orchestrate or generate themed channel programming ("Channel Director") based on custom parameters (e.g., "Create a Saturday Morning 90s Cartoons channel", "Create a Sci-Fi Movie Night schedule with 30-min sitcom fillers").

## Deployment Topology & Constraints

- **Remote Bot**: Runs on Coolify (VPS, reachable via Tailscale proxy when `USE_PROXY=true`).
- **Local Stack**: ErsatzTV runs on the local media host (default `http://localhost:8409` or `http://100.103.71.60:8409`), alongside Plex, Radarr, Sonarr, qBittorrent, and the proxy server (`src/proxy.ts`).
- **Proxy Bridge**: All calls from the remote bot to ErsatzTV must pass through `src/proxy.ts` via `executeOnProxy("ersatztv", methodName, args)` when `isProxyEnabled()` is true.

## Goals

1. **ErsatzTV Service Module (`src/services/ersatztv.ts`)**:
   - Standard REST client for ErsatzTV REST API (`/api/v2` endpoints).
   - Functions for: `getSystemStatus()`, `getChannels()`, `getDailyGuide(channelId?, date?)`, `getPlayouts()`, `getSchedules()`, `createChannelDirectorProgramming(params)`.
   - Full TypeScript types in `src/types/ersatztv.ts`.

2. **System Health Integration (`src/services/health.ts`)**:
   - Register ErsatzTV in `checkAllServices()` so `/status` and system health reporting includes ErsatzTV status and connection latency.

3. **Proxy Bridge Integration (`src/proxy.ts`)**:
   - Expose `ersatztv` service endpoints in the `proxy.ts` service handler table for remote execution.

4. **Agent Tools (`src/agent/tools/ersatztv-tools.ts`)**:
   - `getErsatzTVStatusTool`: Check status, channel count, active playouts.
   - `getErsatzTVGuideTool`: Retrieve daily guide / schedule per channel or for all channels.
   - `channelDirectorTool`: Automated creation/reconfiguration of channel programming using target parameters (genres, show lists, year ranges, block scheduling, slot durations, fillers).

5. **Channel Director Skill (`skills/channel-director/SKILL.md`)**:
   - Documentation and prompt guidance for parameterizing automated TV channel programming generation.

6. **Config & Environment**:
   - Add `ERSATZTV_URL` and `ERSATZTV_API_KEY` support in `.env.example` and validation in `src/verify-config.ts`.

7. **Automated Testing**:
   - Unit and integration tests in `src/services/__tests__/ersatztv.test.ts` and `src/agent/tools/__tests__/ersatztv-tools.test.ts` using MSW.

## Non-Goals

- Transcoding or streaming media content directly through the Telegram bot.
- Managing raw video file downloads inside ErsatzTV (handled by Radarr/Sonarr).
- Replacing ErsatzTV's full Web UI configuration for initial hardware decoder settings.

## Detailed Requirements & Schemas

### 1. Daily Guide Schema (`ErsatzTVDailyGuide`)

```typescript
export interface ErsatzTVGuideProgram {
  id: string;
  title: string;
  subTitle?: string;
  description?: string;
  start: string; // ISO timestamp
  end: string;   // ISO timestamp
  durationMinutes: number;
  channelNumber: string;
  channelName: string;
  type: "movie" | "episode" | "music_video" | "other";
  seasonNumber?: number;
  episodeNumber?: number;
}

export interface ErsatzTVDailyGuide {
  date: string; // YYYY-MM-DD
  channels: Array<{
    id: string;
    number: string;
    name: string;
    programs: ErsatzTVGuideProgram[];
  }>;
}
```

### 2. Channel Director Parameters (`ChannelDirectorParams`)

```typescript
export interface ChannelDirectorParams {
  channelId?: string;
  channelNumber?: string;
  channelName: string;
  contentFilters: {
    genres?: string[];
    showTitles?: string[];
    releaseYearRange?: {
      min?: number;
      max?: number;
    };
    tags?: string[];
  };
  scheduleMode: "block" | "chronological" | "random" | "shuffle";
  slotDurationMinutes?: number;
  includeFillers?: boolean;
  watermarkId?: string;
}

export interface ChannelDirectorResult {
  success: boolean;
  channelId: string;
  channelNumber: string;
  channelName: string;
  scheduleId: string;
  playoutId: string;
  message: string;
}
```

## Acceptance Criteria

1. Running `checkAllServices()` returns ErsatzTV status without failing when ErsatzTV is offline or not configured.
2. The agent can answer "What's playing on ErsatzTV today?" by calling `getErsatzTVGuideTool` and formatting a readable daily guide response.
3. The agent can take a prompt like "Set up a 90s cartoon channel on channel 10" and execute `channelDirectorTool` to program a schedule matching those filters.
4. Proxy execution works cleanly when `USE_PROXY=true`.
5. All new features are fully typed (`no any`), clean code, and backed by Bun test cases using MSW mocks.
