# Spec — Mechanical tool skill extraction + Ollama intent-routing pilot

**Date:** 2026-08-06
**Slug:** `mechanical-skill-extraction-pilot`
**Status:** Draft — pending approval

## Problem statement

An idea document proposed extracting "hardcoded, inline tool implementations"
for MKV track editing and Bazarr subtitle automation out of this bot into a
shared `media-tools` repo. Investigation found that premise doesn't hold: this
bot has no MKV or Bazarr code at all (`grep` across `src/` for `mkvpropedit`,
`mkvmerge`, and Bazarr/port-6767 references returns nothing). `media-tools`
already exists, already implements both capabilities standalone, already ships
a `media-library` skill, and that skill is already committed to
`skills-marketplace` (unpushed). There is nothing to extract for those two
capabilities.

What the bot *does* have is seven tool-domain files under
`src/agent/tools/` (`sonarr-tools.ts`, `radarr-tools.ts`, `plex-tools.ts`,
`download-tools.ts`, `system-tools.ts`, `watchlist-tools.ts`,
`reports-tools.ts`), each built with the Vercel AI SDK's `tool()` helper and
wired into a single cloud-model tool-calling loop
(`src/agent/index.ts:141-329`). Two real gaps exist:

1. These tool implementations are private to this bot's process — nothing
   else (another AI assistant, `media-hub`'s dashboard, a script) can reuse
   the "check if Sonarr is up" or "get the NZBGet queue" logic without
   reimplementing it.
2. Every user message — including fully mechanical ones like "is Sonarr up?"
   — pays for a full cloud-model tool-selection pass over all ~27 registered
   tools. The bot already has a local Ollama model available on the same host
   as the media stack (`ollama.service`, confirmed running), currently only
   usable as an all-or-nothing swap for the *entire* model via
   `AI_PROVIDER=ollama` — there's no per-request hybrid routing today.

This pilot extracts the most clearly mechanical slice of the tool surface
into a reusable, marketplace-distributable skill, and adds a local-model
pre-classification step ahead of the existing cloud tool loop, to validate
both patterns before rolling them out to the other five domains.

## Deployment topology (constrains the design)

The bot runs remotely on Coolify (VPS, tailnet `100.125.118.66`); the media
stack, `media-tools`, and Ollama all run on this local machine (tailnet
`100.103.71.60`). The only bridge between them is the existing Tailscale
proxy: `src/proxy.ts` (local, port 3001) exposes `POST /api/tool`, and
`src/agent/proxyClient.ts`'s `executeOnProxy(service, method, args)` is how
remote service wrappers (`services/nzbget.ts`, `services/qbittorrent.ts`,
etc.) already reach local services when `USE_PROXY=true`. Any new local
resource — `media-tools`, Ollama — is unreachable from the bot process except
through this same bridge. This directly informs Goals 2 and 3 below.

## Goals

1. **Extract two mechanical skills into `media-tools`**:
   - `service-health`: `checkServiceHealthTool` and `getDiskSpaceTool`,
     cherry-picked out of `system-tools.ts` (`discoverMediaTool` stays — it
     does TMDB cross-referencing against Plex/Radarr/Sonarr and needs
     judgment, not a mechanical lookup).
   - `download-queue`: the entirety of `download-tools.ts` (`getTorrents`,
     `pauseTorrent`, `resumeTorrent`, `pauseAllTorrents`,
     `resumeAllTorrents`, `getNZBGetQueue`).
   - Each ships as a `media-tools` module (`src/service-health-manager.ts`,
     `src/download-queue-manager.ts`), a CLI subcommand, and its own
     `skills/<name>/SKILL.md`, following the existing `media-library`
     pattern exactly (same repo, same packaging shape).
2. **Bridge the bot to the extracted skills without duplicating logic**:
   - Add `media-tools` as a `proxy.ts` dependency (`file:../media-tools`,
     matching the existing `chowa: "file:../chōwa"` pattern) and register it
     as a new `mediaTools` entry in `proxy.ts`'s service-dispatch map.
   - Give the bot's `system-tools.ts`/`download-tools.ts` a thin client
     module mirroring `services/nzbget.ts`'s existing shape: call
     `media-tools` directly when running locally (`USE_PROXY` unset, e.g.
     local dev), or via `executeOnProxy("mediaTools", method, args)` in
     production. `proxy.ts` stops importing `radarr`/`sonarr` (for
     `getSystemStatus`/`getRootFolders`) and `qbittorrent`/`nzbget` (for
     these six operations) directly for this slice — `media-tools` becomes
     the one implementation both the proxy and any future consumer share.
3. **Register both skills in `skills-marketplace`**, alongside the existing
   `media-library` entry, and push the currently-unpushed
   `refactor/reference-chowa-skill-externally` branch so that registration
   actually reaches origin.
4. **Add an Ollama Step 0 intent classifier** ahead of the bot's existing
   Step 1 tool loop (`agent/index.ts:141`):
   - A new local-model call, routed through the same proxy bridge (new
     `ollamaClassify` proxy method, not a direct Tailscale exposure of
     Ollama — reuses the proxy's existing auth/retry instead of adding a
     second local attack surface) classifies the incoming message against
     the known skill domains (`service-health`, `download-queue`, plus
     "none/uncertain").
   - On a confident match, Step 1 receives only that domain's tools instead
     of the full ~27-tool set. On no match or low confidence, Step 1 gets
     the full set exactly as it does today. This is strictly a narrowing
     optimization — the cloud model still makes every tool call and
     generates every response; nothing about tool *execution* moves to
     Ollama in this pilot.

## Non-goals

- The other five tool domains (Sonarr/Radarr content management, Plex,
  watchlist, reports) — deferred to later rounds once this pattern is
  validated.
- Any marketplace discovery UI/registry tooling beyond adding two entries
  next to the existing `media-library` skill.
- Skipping the cloud model entirely for mechanical requests (a possible
  future round; explicitly out of scope per the "cloud model still
  executes" decision made during design).
- Changing `AI_PROVIDER=ollama`'s existing full-swap behavior.
- Fixing the unrelated `services/sonarr.ts:150-163` `restartSonarrService()`
  snap-vs-podman-container mismatch found during investigation — flagged for
  a separate change, not bundled here.
- Any change to `media-hub` or its existing
  `2026-08-06-media-library-skill-extraction` spec (that spec's acceptance
  criteria for MKV/Bazarr marketplace registration are handled by pushing
  the already-committed `skills-marketplace` branch; nothing else there
  needs work).

## Proposed behaviour

**Request flow after this pilot:**

```
Telegram message
  → agent/index.ts: Step 0 — ollamaClassify(message) via proxy
      confident match (service-health | download-queue)?
        yes → Step 1 runs with only that domain's tools
        no/uncertain → Step 1 runs with the full tool set (today's behavior)
  → Step 1 (cloud "fast" model, unchanged mechanism) selects + calls tools
      tool execute() → thin client → USE_PROXY?
        true  → executeOnProxy("mediaTools", method, args) → proxy.ts →
                 media-tools module → real service call (local network)
        false → media-tools module called in-process (local dev)
  → Step 2 (cloud "capable" model, unchanged) synthesizes the reply
```

## Edge cases

- **Ollama unreachable / proxy down during Step 0** — classification failure
  must fail open to "no match", not block the message. Step 1 proceeds with
  the full tool set, same as if Ollama had returned "uncertain".
- **Classifier picks a domain but the cloud model wants a tool outside it**
  (e.g. classified as `download-queue` but the user's follow-up actually
  needs `searchMovie`) — Step 0 only narrows the *first* Step 1 call; if
  Step 1 needs a tool that got filtered out, it has no way to ask for it
  back within the same turn. Acceptable for this pilot since both piloted
  domains are self-contained (no cross-domain follow-ups expected in a
  single turn) — flagged as a known limitation, not fixed here.
- **`media-tools` reachable from `proxy.ts` but not from the bot directly**
  — expected and correct; the bot must never import `media-tools` directly,
  only through the proxy client / local-dev branch, matching every existing
  service wrapper.
- **`getDiskSpaceTool` and `checkServiceHealthTool` currently import
  `radarr`/`sonarr`/`plex`/`qbittorrent`/`nzbget` service wrappers that
  themselves branch on `isProxyEnabled()`** — once these two tools call
  `media-tools` instead, that double-proxying (bot → proxy → media-tools →
  [service wrapper that itself might re-proxy]) must collapse to a single
  hop. `media-tools`' new modules talk to Radarr/Sonarr/Plex/qBittorrent/
  NZBGet directly (they run on the same host media-tools does); they must
  not import the bot's `services/*.ts` proxy-aware wrappers.
- **Skill/marketplace divergence** — `service-health`/`download-queue`
  `SKILL.md`s must stay identical between `media-tools/skills/` and
  `skills-marketplace/skills/`, same as the existing `media-library` pair
  (verify with `diff`, matching how that pair was checked during design).

## Acceptance criteria

1. `media-tools`: `src/service-health-manager.ts` and
   `src/download-queue-manager.ts` exist, exported via `bin/media-tools.ts`
   as new CLI subcommands, each with unit tests; `bun test` passes.
2. `media-tools/skills/service-health/SKILL.md` and
   `media-tools/skills/download-queue/SKILL.md` exist and are identical to
   their `skills-marketplace/skills/` counterparts.
3. `skills-marketplace`'s `refactor/reference-chowa-skill-externally` branch
   (or its successor) is pushed to origin and the two new skills are
   committed there.
4. `proxy.ts` dispatches `service` = `"mediaTools"` to the new `media-tools`
   modules; `checkServiceHealthTool`, `getDiskSpaceTool`, and all six
   `download-tools.ts` tools route through it in production
   (`USE_PROXY=true`) and call `media-tools` in-process in local dev.
5. `src/agent/index.ts` runs an Ollama-backed Step 0 before Step 1; on a
   confident match it demonstrably narrows the tool set (verified by a test
   asserting the filtered tool list for a `service-health`-classified
   message), and fails open to the full tool set on any Step 0 error.
6. `bun test` passes in `agentic-media-bot` with no regressions to existing
   `sonarr-tools`/`download-tools`/`system-tools` behavior.
7. `FUNCTIONAL_SPEC.md`/`TECHNICAL_SPEC.md` updated per
   `.agents/workflows/rules.md`, and `CHANGELOG.md` gets an entry.

## Verification

Per `.agents/workflows/rules.md`: audit `FUNCTIONAL_SPEC.md` /
`TECHNICAL_SPEC.md`, update `CHANGELOG.md`, confirm `src/verify-config.ts`
needs a new check for the `mediaTools` proxy path reachability (mirroring its
existing Ollama/proxy checks). Per `.agents/AGENTS.md`: the bot is never
launched locally — proxy-path testing happens against the local proxy
(`bun run src/proxy.ts`) and `bun test`, not a live bot process.

## Branching

Branches from `master` (this repo's default branch) as
`feat/mechanical-skill-extraction-pilot`. Companion work in `media-tools`
(currently `main`, clean) and `skills-marketplace` (currently
`refactor/reference-chowa-skill-externally`, one commit ahead of origin,
unpushed) happens in those repos' own branches per their own conventions.
