# Spec — Fix proxy/bot `media_events` double-write

**Date:** 2026-08-01
**Slug:** `proxy-media-event-double-write`
**Branch:** `fix/proxy-media-event-double-write`
**Status:** Approved — implemented in `4.42.25`

## Problem statement

Two independent processes write the same webhook event to the shared
`media_events` table:

- `src/proxy.ts:324` — writes inside a fire-and-forget background block, using the
  **raw** event type from the payload (`Download`, `Grab`, `added`).
- `src/services/webhooks.ts` — the bot writes via `webhookEventQueue`'s `dbSave`
  closure, using a **lowercased** event type (`download`, `grab`, `added`).

Both point at the same SQLite file, because `src/services/database.ts:6` resolves
`DATA_DIR` as the relative path `"data"` and both units share
`WorkingDirectory=/home/fran/Documentos/media-stack/bot`.

`saveMediaEvent` (`src/services/database.ts:404`) dedups on
`(service, event_type, title)` within a 60-second window, and the event queue
skips delivery entirely when `dbSave()` returns `false`
(`src/services/eventQueue.ts:98-102`).

This produces two defects:

### D1 — Silent notification loss for NZBGet and qBittorrent

For these two services the proxy and the bot derive **byte-identical** tuples:

| field | proxy | bot |
|---|---|---|
| `service` | `"nzbget"` | `"nzbget"` |
| `event_type` | `payload.event \|\| "added"` (`proxy.ts:276`) | `event \|\| "added"` (`webhooks.ts:587`) |
| `title` | `payload.title` (`proxy.ts:277`) | `title` (`webhooks.ts:585`) |

The proxy's insert lands first, so the bot's `dbSave()` sees its own event as a
duplicate, returns `false`, and the Telegram notification is dropped with only a
`🔁 EventQueue: DB dedup dropped` log line. NZBGet and qBittorrent notifications
can never be delivered while this holds.

Radarr/Sonarr/Plex escape only by accident — the casing (`Download` vs
`download`) and title formats differ, so their tuples don't collide.

### D2 — Duplicated history rows

Because the two writers disagree on casing, every Radarr/Sonarr event is stored
twice under different `event_type` values. Production DB counts:

```
sonarr|Download|351   (proxy)   sonarr|download|188   (bot)
sonarr|Grab|204       (proxy)   sonarr|grab|142       (bot)
radarr|Download|26    (proxy)   radarr|download|15    (bot)
```

Any consumer of `getRecentMediaEvents` sees inflated counts and duplicate
entries.

## Goals

1. Exactly one `media_events` row per logical webhook event.
2. `dbSave()` in the bot never returns `false` because of a proxy-written row, so
   NZBGet/qBittorrent notifications can be delivered.
3. Preserve event history when the brain (bot) is unreachable — the proxy's write
   is currently the only thing recording events while the bot is offline
   (`proxy.ts:360-361` documents this intent).
4. Preserve the `[WEBHOOK]` diagnostic log line for every received webhook,
   regardless of relay outcome.

## Non-goals

- Fixing `BRAIN_WEBHOOK_URL` (points at `localhost:3000`; the bot runs remotely
  on Coolify). Operational config, tracked separately.
- Adding the NZBGet extension script or the qBittorrent completion hook. Neither
  service is currently configured to emit webhooks at all.
- Adding a `BRAIN_WEBHOOK_URL` reachability check to `verify-config.ts`.
- Backfilling or de-duplicating the existing historical rows.
- Any change to the dedup window or to `eventQueue` semantics.

## Proposed behaviour

Make the **bot the sole writer on the happy path**, and demote the proxy's write
to a fallback that only fires when the relay fails.

| scenario | proxy `saveMediaEvent` | bot `saveMediaEvent` | rows |
|---|---|---|---|
| relay succeeds | no | yes | 1 |
| relay fails / `BRAIN_WEBHOOK_URL` unset | yes | n/a (never reached) | 1 |

Payload parsing moves out of the fire-and-forget block into a helper whose result
is available to the relay-failure path. The `[WEBHOOK]` log line is still written
on every request.

## Edge cases

- **Unparseable payload** — parsing fails; log the existing `[WEBHOOK] [ERROR]`
  line and still relay the untouched body. A parse failure must never block the
  relay.
- **`BRAIN_WEBHOOK_URL` unset** — treated as relay failure: proxy writes the row,
  returns 200 (unchanged from today).
- **Relay returns a non-2xx status** — the bot answered, so it owns the write.
  Only a thrown `fetch` error (connection refused / DNS / timeout) counts as
  relay failure. This keeps behaviour aligned with the existing `try/catch`.
- **Body consumption** — the relay forwards `req.body`; parsing must continue to
  use `req.clone()` so the stream stays readable.
- **Latency** — parsing is an in-memory body read; it must not add a network
  round-trip before the relay.
- **Non-webhook paths** — routes not ending in `-webhook` are untouched.

## Acceptance criteria

1. A successful relay of an NZBGet `added` webhook results in exactly one
   `media_events` row, and the bot's `dbSave()` returns `true` (notification is
   sent).
2. A failed relay of the same webhook results in exactly one `media_events` row,
   written by the proxy.
3. Radarr/Sonarr/Plex webhooks produce exactly one row per event after the change.
4. A `[WEBHOOK]` log line is emitted in both the success and failure cases.
5. A malformed payload does not prevent the relay from being attempted.
6. `bun test` passes, including the existing
   `src/services/__tests__/media_events.test.ts` and `webhook_fanout.test.ts`.

## Verification

Per `.agents/workflows/rules.md`, additionally:

- Audit `FUNCTIONAL_SPEC.md` / `TECHNICAL_SPEC.md` and update if behaviour
  documented there changes.
- Update `CHANGELOG.md` (semver patch — bug fix, no API change).
- Confirm `src/verify-config.ts` needs no new checks (no new env vars added).
- Do **not** run the bot locally (`.agents/AGENTS.md`).
