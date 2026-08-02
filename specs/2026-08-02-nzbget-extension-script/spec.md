# Spec — NZBGet extension script for bot notifications

**Date:** 2026-08-02
**Slug:** `nzbget-extension-script`
**Status:** Approved — implemented in `4.43.0`

## Problem statement

The bot exposes `/nzbget-webhook` (`src/bot.ts:106`) and a handler that formats
`added` and `success` events (`src/services/webhooks.ts:582-662`), and the proxy
relays that path (`src/proxy.ts`). But **NZBGet has never called it** — zero
`nzbget` rows exist in either database, ever.

NZBGet has no native webhook support. It only makes outbound HTTP calls from
extension scripts, and none is installed:

```
ScriptDir  = /config/scripts     (empty on disk)
Extensions = ''
Category1.Extensions = ''   (…2, 3, 4 all empty)
```

So the entire NZBGet notification path is dead code today.

## Environment (verified, not assumed)

| fact | value |
|---|---|
| NZBGet version | `26.2` (RPC `version`) |
| Container | `lscr.io/linuxserver/nzbget:latest`, rootless podman, Alpine |
| Networking | `--network=host` → the proxy is reachable at `localhost:3001` |
| `/config` mount | `/home/fran/Documentos/media-stack/nzbget/config` |
| ScriptDir on host | `…/media-stack/nzbget/config/scripts` (exists, empty) |
| Interpreters in container | `/bin/bash`, `/bin/sh`, `/usr/bin/curl`, `/usr/bin/wget`, `/lsiopy/bin/python3` |

Extension contract for v23+ (from nzbget.com docs and the `nzbgetcom` reference
extensions):

- Each extension is a **subfolder of ScriptDir** containing `manifest.json` plus
  the file named by its `main` field.
- `kind` is a `/`-joined set — `"POST-PROCESSING"`, `"SCAN/QUEUE/SCHEDULER"`.
  This one needs `"QUEUE/POST-PROCESSING"`.
- `queueEvents` declares which queue events invoke the script, e.g. `"NZB_ADDED"`.
- Queue scripts get `NZBNA_*` (`NZBNA_NZBNAME`, `NZBNA_EVENT`, `NZBNA_CATEGORY`,
  `NZBNA_NZBID`, …). `NZBNA_EVENT` ∈ `NZB_ADDED`, `FILE_DOWNLOADED`,
  `NZB_DOWNLOADED`, `NZB_DELETED`, `URL_COMPLETED`.
- Post-processing scripts get `NZBPP_*` (`NZBPP_NZBNAME`, `NZBPP_TOTALSTATUS` ∈
  `SUCCESS|WARNING|FAILURE|DELETED`, `NZBPP_STATUS`, `NZBPP_CATEGORY`, …).
- Manifest `options` become `NZBPO_<NAME>` env vars.
- Post-processing exit codes: **93** success, **94** error, **95** skipped.

## Goals

1. NZBGet POSTs `{ "event": "added", "title": … }` when an NZB enters the queue.
2. NZBGet POSTs `{ "event": "success", "title": … }` when a download finishes
   successfully.
3. The target URL is configurable from the NZBGet UI, defaulting to
   `http://localhost:3001/nzbget-webhook` (the proxy, matching how
   Radarr/Sonarr/Plex are wired).
4. The script never fails a download. A webhook error is logged and the script
   still exits `93`.
5. The script is version-controlled in this repo and installed by a documented,
   repeatable step.

## Non-goals

- Fixing `BRAIN_WEBHOOK_URL` — see "Dependency" below. Tracked separately.
- The qBittorrent completion hook (same class of gap, separate change).
- Reporting `speed`/`eta`. Both are optional in the payload; at `NZB_ADDED` time
  NZBGet's speed is a global rate, not per-NZB, so a value there would be
  misleading. The bot already omits those lines when absent.
- Notifying on `WARNING`/`FAILURE`/`DELETED` outcomes — the bot's handler only
  formats `added` and `success` (`webhooks.ts:590-615`); anything else produces
  no message.
- Auto-enabling the extension by editing `nzbget.conf` (see edge cases).

## Dependency — this alone will not deliver notifications

The script POSTs to the **proxy**, which relays to the bot via
`BRAIN_WEBHOOK_URL`. That value is currently `http://localhost:3000`, which is
not the bot (the bot runs on Coolify; locally that port is an unrelated dev
server). Until it points at the real bot, these webhooks will reach the proxy
and go no further.

Both changes are required for NZBGet notifications to actually arrive. This spec
covers only the NZBGet half.

## Proposed behaviour

One extension, `AgenticMediaBot`, registered as both a queue script and a
post-processing script:

| trigger | condition | POST body |
|---|---|---|
| queue, `NZBNA_EVENT=NZB_ADDED` | always | `{"event":"added","title":"$NZBNA_NZBNAME"}` |
| post-processing | `NZBPP_TOTALSTATUS=SUCCESS` | `{"event":"success","title":"$NZBPP_NZBNAME"}` |
| post-processing | any other status | none; exit `95` (skipped) |

Written in `bash` using `curl` — both confirmed present in the container, and it
avoids depending on the image's bundled Python.

Manifest options:

| option | default | purpose |
|---|---|---|
| `WebhookUrl` | `http://localhost:3001/nzbget-webhook` | target endpoint |
| `Timeout` | `10` | curl timeout in seconds |

## Edge cases

- **Webhook unreachable / non-2xx** — log the failure, still exit `93`. A
  notification problem must never mark a good download as failed (goal 4).
- **Titles with quotes, backslashes or non-ASCII** — the body is JSON, so the
  title must be JSON-escaped rather than string-interpolated. Japanese titles
  already occur in this library (`キャプテン翼`).
- **`NZBNA_EVENT` set to an event we don't handle** — exit `0` immediately
  without POSTing. `queueEvents` narrows this, but the guard is still required.
- **Script invoked with neither `NZBNA_*` nor `NZBPP_*` set** (e.g. a UI test) —
  exit `95`, no POST.
- **Timeout** — bounded by `--max-time`, so a hung proxy cannot stall the queue.
- **Enabling the extension** — NZBGet only runs extensions listed in
  `Extensions` (or a category's `Extensions`). Installing files is not enough;
  the extension must be enabled in Settings. `nzbget.conf` is user state outside
  this repo, so the spec does **not** script that edit — it is a documented
  manual step, verified afterwards via RPC.

## Acceptance criteria

1. `manifest.json` parses as JSON and declares `kind: "QUEUE/POST-PROCESSING"`,
   `main`, and `queueEvents: "NZB_ADDED"`.
2. Running the script with `NZBNA_EVENT=NZB_ADDED` and a set `NZBNA_NZBNAME`
   POSTs exactly `{"event":"added","title":…}` to the configured URL.
3. Running it with `NZBPP_TOTALSTATUS=SUCCESS` POSTs `{"event":"success",…}` and
   exits `93`.
4. Running it with `NZBPP_TOTALSTATUS=FAILURE` POSTs nothing and exits `95`.
5. A title containing `"` and non-ASCII characters produces valid JSON, verified
   by parsing the received body.
6. An unreachable webhook URL still exits `93`.
7. After installation, NZBGet reports the extension as detected.
8. `bun test` still passes; `bunx biome`-equivalent project checks unaffected.

## Verification

Per `.agents/workflows/rules.md`: audit `FUNCTIONAL_SPEC.md` /
`TECHNICAL_SPEC.md` and update for the new integration, add a `CHANGELOG.md`
entry, and confirm `src/verify-config.ts` needs no new env var checks (the
script's config lives in NZBGet, not in the bot's `.env`).

`.agents/AGENTS.md`: the bot is never launched locally at any point.

## Branching

PR #3 merged as `7fa4339`, so `specs/INDEX.md` is on `master`. This work branches
from `master` as `feat/nzbget-extension-script`; no conflict.
