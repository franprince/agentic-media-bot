# Implementation Plan — Mechanical tool skill extraction + Ollama intent-routing pilot

**Spec:** [`spec.md`](./spec.md)
**Branches:** `feat/mechanical-skill-extraction-pilot` in `agentic-media-bot`
(from `master`); companion branches in `media-tools` (from `main`, currently
clean) and `skills-marketplace` (continues on
`refactor/reference-chowa-skill-externally`, one commit ahead of origin).
**Status:** Draft — pending approval

This plan touches three repos. Work proceeds `media-tools` →
`skills-marketplace` → `agentic-media-bot`, since the bot side depends on the
other two existing.

Note found during design, not part of this pilot but recorded for later:
`agentic-media-bot/src/services/health.ts`'s `checkAllServices()` calls the
same underlying Radarr/Sonarr/Plex/qBittorrent/NZBGet status endpoints as
`checkServiceHealthTool`, for a different call site (bulk status, not a
single named-service check). Left unmigrated — out of scope, flagged for a
future round once this pattern is validated.

## Part 1 — `media-tools`

### 1. `src/clients/` — new directory, four new files

Thin, env-configured HTTP clients, each throwing loudly if required env vars
are missing (matching the `BazarrManager` fix already applied in this repo).
No dependency on `agentic-media-bot`'s proxy-aware wrappers — these talk to
the services directly, since `media-tools` always runs on the same host the
media stack does.

- **`radarr-client.ts`**: `getSystemStatus()`, `getRootFolders()`. Reads
  `RADARR_URL`, `RADARR_API_KEY`.
- **`sonarr-client.ts`**: `getSystemStatus()`, `getRootFolders()`. Reads
  `SONARR_URL`, `SONARR_API_KEY`.
- **`plex-client.ts`**: `getSystemStatus()`. Reads `PLEX_URL`, `PLEX_TOKEN`.
- **`qbittorrent-client.ts`**: `getTorrents(filter)`, `pauseTorrent(hash)`,
  `resumeTorrent(hash)`, `pauseAllTorrents()`, `resumeAllTorrents()` — same
  auth-cookie flow as the bot's `services/qbittorrent.ts`. Reads
  `QBITTORRENT_URL`, `QBITTORRENT_USERNAME`, `QBITTORRENT_PASSWORD`.
- **`nzbget-client.ts`**: `getQueue()`, `getStatus()`, `getVersion()` — same
  JSON-RPC shape as the bot's `services/nzbget.ts`. Reads `NZBGET_URL`,
  `NZBGET_USERNAME`, `NZBGET_PASSWORD`.

These return **raw data** (booleans, byte counts, seconds, raw torrent/queue
objects) — no human-readable formatting. Formatting stays a presentation
concern of whatever consumes the skill (see Part 3).

### 2. `src/service-health-manager.ts` — new

```ts
export class ServiceHealthManager {
  async checkServiceHealth(service: string): Promise<{ online: boolean }> {
    // dispatch to the matching client's getSystemStatus() / getVersion() /
    // getTorrents("all"); same service-name switch as today's
    // checkServiceHealthTool, returns { online: boolean } only — no message
    // string, that's a presentation concern for the consumer.
  }

  async getDiskSpace(): Promise<Array<{ service: string; path: string; freeBytes: number }>> {
    // radarr-client.getRootFolders() + sonarr-client.getRootFolders(),
    // merged — same shape as today's getDiskSpaceTool minus the
    // pre-formatted freeSpace string.
  }
}
```

### 3. `src/download-queue-manager.ts` — new

```ts
export class DownloadQueueManager {
  getTorrents(filter?: string) { /* qbittorrent-client.getTorrents */ }
  pauseTorrent(hash: string) { /* qbittorrent-client.pauseTorrent */ }
  resumeTorrent(hash: string) { /* qbittorrent-client.resumeTorrent */ }
  pauseAllTorrents() { /* qbittorrent-client.pauseAllTorrents */ }
  resumeAllTorrents() { /* qbittorrent-client.resumeAllTorrents */ }
  getNZBGetQueue() { /* nzbget-client.getQueue() + getStatus(), merged */ }
}
```

### 4. `src/interfaces.ts` — extend

Add the return-shape interfaces used by the two new managers and clients
(`IServiceHealthResult`, `IDiskSpaceEntry`, `IDownloadQueueEntry`, etc.),
following the existing `IMKVTrack`/`IBazarrLanguageProfile` style.

### 5. `index.ts` — replace placeholder

Currently just `console.log("Hello via Bun!")`. Replace with real exports so
`proxy.ts` can `import { ServiceHealthManager, DownloadQueueManager } from
"media-tools"`:

```ts
export { MKVTrackManager } from "./src/mkv-track-manager";
export { BazarrManager } from "./src/bazarr-manager";
export { ServiceHealthManager } from "./src/service-health-manager";
export { DownloadQueueManager } from "./src/download-queue-manager";
```

### 6. `bin/media-tools.ts` — extend

Add `health <service>` and `downloads` subcommands, same
`process.argv`-dispatch style as the existing `tracks`/`bazarr` commands.

### 7. `tests/service-health-manager.test.ts`, `tests/download-queue-manager.test.ts` — new

Same style as `tests/mkv-track-manager.test.ts`: construct the manager,
stub `fetch` (via `mock()` or a local test server), assert the returned
shape and that a missing env var throws before any network call.

### 8. `README.md` — extend

Document the new env vars (mirroring the `Configuration` section just added
for Bazarr) and the two new CLI subcommands.

**Verification:** `bun test` (all tests, including the two new files) must
pass before moving to Part 2.

## Part 2 — `skills-marketplace`

### 1. `skills/service-health/SKILL.md`, `skills/download-queue/SKILL.md` — new

Same shape as the existing `skills/media-library/SKILL.md`: frontmatter
`name`/`description`, a short usage section pointing at
`bun run bin/media-tools.ts health <service>` /
`bun run bin/media-tools.ts downloads`. Copied byte-for-byte from
`media-tools/skills/service-health/SKILL.md` and
`media-tools/skills/download-queue/SKILL.md` (media-tools is the source of
truth; marketplace is a mirror, matching the existing `media-library` pair —
verified with `diff`).

### 2. Push

Push `refactor/reference-chowa-skill-externally` (currently one commit ahead
of origin, unpushed) plus the new skill commit. Confirms spec acceptance
criterion 3.

## Part 3 — `agentic-media-bot`

### 1. `package.json` — add optional dependency

```json
"optionalDependencies": {
  "chowa": "file:../chōwa",
  "media-tools": "file:../media-tools"
}
```

### 2. `src/proxy.ts` — register the new service

```ts
import * as mediaToolsPkg from "media-tools";
const serviceHealthManager = new mediaToolsPkg.ServiceHealthManager();
const downloadQueueManager = new mediaToolsPkg.DownloadQueueManager();

const services: Record<string, any> = {
  radarr, sonarr, plex, qbittorrent, nzbget, tools: aiTools,
  mediaTools: {
    checkServiceHealth: (service: string) => serviceHealthManager.checkServiceHealth(service),
    getDiskSpace: () => serviceHealthManager.getDiskSpace(),
    getTorrents: (filter?: string) => downloadQueueManager.getTorrents(filter),
    pauseTorrent: (hash: string) => downloadQueueManager.pauseTorrent(hash),
    resumeTorrent: (hash: string) => downloadQueueManager.resumeTorrent(hash),
    pauseAllTorrents: () => downloadQueueManager.pauseAllTorrents(),
    resumeAllTorrents: () => downloadQueueManager.resumeAllTorrents(),
    getNZBGetQueue: () => downloadQueueManager.getNZBGetQueue(),
    classifyIntent: (message: string) => ollamaClassifier.classifyIntent(message),
  },
};
```

`radarr`/`sonarr`/`qbittorrent`/`nzbget` stay registered as-is — other tools
(`addMovie`, `searchSeries`, etc.) still use them directly. Only the six
download-queue operations and the two service-health operations move to the
`mediaTools` dispatch entry.

### 3. `src/services/ollamaClassifier.ts` — new

Proxy-side only (never imported by the remote bot process directly — reached
through `mediaTools.classifyIntent` above). Calls the local Ollama instance
(`OLLAMA_BASE_URL`, default `http://127.0.0.1:11434`) with a short prompt
listing the two pilot domains and their trigger phrases, requesting strict
JSON: `{"domain": "service-health"|"download-queue"|null, "confidence": 0-1}`.
Defensive parsing — any fetch failure, non-2xx, or unparseable body returns
`{ domain: null, confidence: 0 }` rather than throwing (spec edge case:
"fail open").

### 4. `src/services/media-tools-client.ts` — new

Mirrors `services/nzbget.ts`'s shape exactly — one exported function per
operation, each branching on `isProxyEnabled()`:

```ts
import { executeOnProxy, isProxyEnabled } from "../agent/proxyClient";

export async function checkServiceHealth(service: string) {
  if (isProxyEnabled()) return executeOnProxy("mediaTools", "checkServiceHealth", [service]);
  const { ServiceHealthManager } = await import("media-tools");
  return new ServiceHealthManager().checkServiceHealth(service);
}
// ...getDiskSpace, getTorrents, pauseTorrent, resumeTorrent,
//    pauseAllTorrents, resumeAllTorrents, getNZBGetQueue — same shape

export async function classifyIntent(message: string) {
  if (isProxyEnabled()) return executeOnProxy("mediaTools", "classifyIntent", [message]);
  const { classifyIntent: classify } = await import("./ollamaClassifier");
  return classify(message);
}
```

### 5. `src/agent/tools/system-tools.ts` — modify

`checkServiceHealthTool` and `getDiskSpaceTool`'s `execute()` bodies swap
their data source from `radarr.getSystemStatus()` /
`sonarr.getRootFolders()` / etc. to `mediaToolsClient.checkServiceHealth()` /
`mediaToolsClient.getDiskSpace()`. Existing formatting (`formatBytes`,
message strings) and error handling stay — only the fetch call changes.
`discoverMediaTool` is untouched.

### 6. `src/agent/tools/download-tools.ts` — modify

Same pattern across all six tools: swap `qbittorrent.*`/`nzbget.*` calls for
the matching `mediaToolsClient.*` call; formatting (`formatBytes`,
`formatDuration`, `getCompletionWallClock`) stays exactly as-is.

### 7. `src/agent/intentRouter.ts` — new

```ts
export const DOMAIN_TOOL_MAP: Record<string, string[]> = {
  "service-health": ["checkServiceHealth", "getDiskSpace"],
  "download-queue": [
    "getTorrents", "pauseTorrent", "resumeTorrent",
    "pauseAllTorrents", "resumeAllTorrents", "getNZBGetQueue",
  ],
};
const CONFIDENCE_THRESHOLD = 0.7;

export async function narrowToolsForMessage(
  message: string,
  tools: Record<string, any>,
): Promise<Record<string, any>> {
  try {
    const { classifyIntent } = await import("../services/media-tools-client");
    const { domain, confidence } = await classifyIntent(message);
    if (domain && confidence >= CONFIDENCE_THRESHOLD && DOMAIN_TOOL_MAP[domain]) {
      const narrowed: Record<string, any> = {};
      for (const name of DOMAIN_TOOL_MAP[domain]) {
        if (tools[name]) narrowed[name] = tools[name];
      }
      if (Object.keys(narrowed).length > 0) return narrowed;
    }
  } catch {
    // fail open — Step 0 must never block a message
  }
  return tools;
}
```

### 8. `src/agent/index.ts` — modify

After the existing tool-set construction and `shouldDisableAddTools`
deletion (`index.ts:143-187`), before the defensive tool filtering
(`index.ts:190+`), insert:

```ts
const narrowedTools = await narrowToolsForMessage(statusSeedText, tools);
```

...and use `narrowedTools` in place of `tools` from that point into Step 1
only. Step 2 (synthesis) is unaffected — it doesn't take a tool set.

### 9. Tests

- `src/services/__tests__/media_tools_client.test.ts` — new. Spies on
  `proxyClient.executeOnProxy`; asserts each function calls it with the
  right `(service, method, args)` triple when `USE_PROXY=true`.
- `src/agent/__tests__/intent_router.test.ts` — new. Table-driven against
  `narrowToolsForMessage`:

  | classifyIntent result | input tools | expected output |
  |---|---|---|
  | `{domain:"service-health", confidence:0.9}` | full ~27-tool set | only `checkServiceHealth`, `getDiskSpace` |
  | `{domain:"download-queue", confidence:0.8}` | full set | only the six download tools |
  | `{domain:null, confidence:0}` | full set | unchanged full set |
  | `{domain:"service-health", confidence:0.4}` (below threshold) | full set | unchanged full set |
  | `classifyIntent` throws | full set | unchanged full set (fail open) |

- `src/agent/__tests__/tools_integrity.test.ts` — no change expected;
  confirms the tool map in `agent/index.ts` still resolves after the
  `system-tools.ts`/`download-tools.ts` edits.
- Extend `src/agent/__tests__/agent_loop.test.ts` (or a new file) with one
  end-to-end case: mock `classifyIntent` to return a confident
  `service-health` match, spy on `ai.generateText`, and assert the `tools`
  argument of the first `generateText` call contains exactly
  `checkServiceHealth`/`getDiskSpace` — covers spec acceptance criterion 5
  directly against the real `processUserMessage` path, not a reimplementation.

### 10. Docs (per `.agents/workflows/rules.md`)

- `TECHNICAL_SPEC.md` — document the `mediaTools` proxy dispatch entry and
  the Step 0 classifier, alongside the existing proxy/service-wrapper
  description.
- `FUNCTIONAL_SPEC.md` — note that service-health and download-queue checks
  are now served by the shared `media-tools` skill rather than bot-inline
  logic.
- `CHANGELOG.md` — new minor version entry; `package.json` bumped to match.
- `src/verify-config.ts` — add a check confirming the `mediaTools` proxy
  path is reachable when `USE_PROXY=true` (mirrors the existing Ollama
  connectivity check), and that `OLLAMA_BASE_URL` responds when the
  classifier is in play.

## Verification

```bash
# media-tools
cd /home/fran/Documentos/media-tools && bun test

# agentic-media-bot
cd /home/fran/Documentos/repos/agentic-media-bot
bun test
bun run check:bot-parse
bun run src/proxy.ts   # manual: confirm it boots with the new mediaTools dispatch entry registered
```

`.agents/AGENTS.md`: the bot itself is never launched locally — only the
proxy and `bun test`.

## Commit plan

**`media-tools`** (already has one commit this session — the `bazarr-manager.ts`
secret fix — landed directly on `main` since it was a standalone, unscoped-to-plan
fix approved separately):

1. `feat(clients): add radarr/sonarr/plex/qbittorrent/nzbget clients` — `src/clients/`
2. `feat: add service-health and download-queue managers` — `src/service-health-manager.ts`, `src/download-queue-manager.ts`, `src/interfaces.ts`, `index.ts`
3. `feat(cli): add health and downloads subcommands` — `bin/media-tools.ts`
4. `feat(skills): add service-health and download-queue skills` — `skills/`, `README.md`
5. `test: add service-health and download-queue manager tests` — `tests/`

**`skills-marketplace`** (on `refactor/reference-chowa-skill-externally`):

6. `feat: add service-health and download-queue skills to marketplace registry` — `skills/`

**`agentic-media-bot`** (on `feat/mechanical-skill-extraction-pilot`):

7. `feat(proxy): dispatch mediaTools service to the media-tools package` — `package.json`, `src/proxy.ts`
8. `feat(agent): add Ollama Step 0 intent classifier` — `src/services/ollamaClassifier.ts`, `src/services/media-tools-client.ts`, `src/agent/intentRouter.ts`
9. `refactor(tools): consume media-tools skill in system-tools and download-tools` — `src/agent/tools/system-tools.ts`, `src/agent/tools/download-tools.ts`, `src/agent/index.ts`
10. `test: cover media-tools-client, intent router, and Step 0 narrowing` — new test files
11. `docs(specs): add spec and plan for the mechanical skill extraction pilot` — `specs/`, `TECHNICAL_SPEC.md`, `FUNCTIONAL_SPEC.md`
12. `chore(release): <next-version>` — `CHANGELOG.md`, `package.json`

Not pushed without approval — this repo's `pre-push` hook auto-deploys to
Coolify. I will ask before pushing `feat/mechanical-skill-extraction-pilot`
or opening a PR, and separately before pushing `skills-marketplace`'s branch
(step 6) since that repo has no auto-deploy hook but does have a real
`origin` remote.

## Out of scope

The other five tool domains (Sonarr/Radarr content management, Plex,
watchlist, reports); `services/health.ts`'s `checkAllServices()`
(duplicate-but-different call site, noted above); marketplace discovery
UI; skipping the cloud model for mechanical requests; `AI_PROVIDER=ollama`'s
existing full-swap behavior; the unrelated `restartSonarrService()`
snap-vs-container mismatch.
