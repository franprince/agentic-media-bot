# Implementation Plan — Fix proxy/bot `media_events` double-write

**Spec:** [`spec.md`](./spec.md)
**Branch:** `fix/proxy-media-event-double-write`
**Status:** Approved — implemented in `4.42.25`

## Component boundaries

The parsing logic currently lives inside a fire-and-forget IIFE nested in
`serve({ fetch })` in `src/proxy.ts`. It cannot be unit-tested there: importing
`src/proxy.ts` executes top-level side effects (`process.exit(1)` when
`PROXY_SECRET_KEY` is unset, then `serve(...)` binding a real port).

So the parse step is extracted into its own side-effect-free module. This is the
only structural change; the relay itself stays inline in `proxy.ts`.

```
src/services/webhookParser.ts   (new, pure)   ← parse payload → ParsedWebhookEvent
        ▲
        │ imported by
src/proxy.ts                    (modified)    ← log always; relay; write only on failure
```

## Files

### 1. `src/services/webhookParser.ts` — new

Exports:

```ts
export interface ParsedWebhookEvent {
  service: string;   // "plex" | "nzbget" | "qbittorrent" | "radarr" | "sonarr"
  event: string;
  title: string;
  message: string;
}

export async function parseWebhookEvent(
  req: Request,          // must already be a clone
  pathname: string,
): Promise<ParsedWebhookEvent | null>;
```

Body is moved verbatim from the IIFE at `src/proxy.ts:250-321` — the same four
branches (plex multipart / nzbget / qbittorrent / radarr-sonarr fallback), same
title-derivation rules, same `message` strings. No behaviour change to parsing.

Differences from the original block:

- Returns the parsed value instead of calling `saveMediaEvent`.
- Returns `null` instead of throwing on a malformed payload, so a parse failure
  can never interfere with the relay (spec edge case 1).
- Returns `null` when `service` or `event` is empty — mirrors the existing
  `if (service && event)` guard at `proxy.ts:323`.
- No `appendFileSync`, no DB access, no `console` side effects beyond an error
  log. Keeps the module unit-testable.

### 2. `src/proxy.ts` — modify the relay block (`:228-374`)

Replace the fire-and-forget IIFE with an awaited parse, then move the DB write
into the failure path.

New order inside `if (req.method === "POST" && url.pathname.endsWith("-webhook"))`:

1. `const parsed = await parseWebhookEvent(req.clone(), url.pathname);`
   — `req.clone()` is retained exactly as today so `req.body` stays readable for
   the relay (spec edge case 4). In-memory read, no network round-trip
   (edge case 5).
2. Always append the `[WEBHOOK]` diagnostic line to
   `/tmp/agentic-media-bot-restart.log` — success line when `parsed` is non-null,
   the existing `[WEBHOOK] [ERROR]` line when it is `null` (goal 4, criterion 4).
   Timestamp formatting via `getTimezone()` is unchanged.
3. If `BRAIN_WEBHOOK_URL` is unset → `saveMediaEvent(parsed)` (when non-null),
   return 200. Same as today's behaviour, plus the write (edge case 2).
4. Relay via `fetch`. On success return the relayed response — **no DB write**;
   the bot owns it.
5. In the existing `catch` → `saveMediaEvent(parsed)` (when non-null), then
   return the same 200 JSON body as today.

A non-2xx relay response is *not* a failure and does not write — only a thrown
`fetch` error reaches the `catch` (spec edge case 3). This is the existing
`try/catch` boundary, unchanged.

The stale comment at `:360-361` ("we already logged the event to the database in
the background block") is rewritten to describe the fallback write.

`saveMediaEvent` stays imported in `proxy.ts` — still used, just on one path.

### 3. `src/services/__tests__/webhook_relay_dedup.test.ts` — new

Two groups, following the `spyOn(database, …)` style already used in
`webhook_fanout.test.ts`:

**`parseWebhookEvent`** (direct, no mocking needed)
- nzbget payload → `{service:"nzbget", event:"added", title:…}`
- qbittorrent form-encoded body → parsed via `URLSearchParams`
- sonarr payload → title formatted `Series - S01E02 - Ep Title`
- plex multipart payload → episode title uses `grandparentTitle`
- malformed JSON → resolves `null`, does not throw
- payload with no derivable event → `null`

**Dedup regression (the actual bug)**
- Reproduces D1 against the real `saveMediaEvent`: write an nzbget row with
  `(service, "added", title)`, then assert a second identical write inside the
  60s window returns `false` — proving that a proxy-written row would suppress
  the bot's notification, and documenting why the proxy must not write on the
  happy path.
- Uses a unique `test_nzb_${Date.now()}` service name and deletes rows in
  `afterEach`, matching `media_events.test.ts`'s isolation pattern (that file
  shares the real `data/bot_data.sqlite`).

### 3b. `src/services/__tests__/webhook_relay_integration.test.ts` — new

**Deviation from the approved plan.** The plan proposed covering criteria 1–3
with "a small harness that mimics the relay branch". That was rejected during
execution: a harness that re-implements the relay logic asserts against the
copy, not against the shipped code, so it would pass even if `proxy.ts` were
wrong.

Instead the real `src/proxy.ts` is driven in a subprocess (`Bun.spawn`) on an
ephemeral port, with `BRAIN_WEBHOOK_URL` pointed at either a stub brain that
returns 200 or a dead port:

- relay succeeds → asserts **zero** `media_events` rows (criterion 1)
- relay fails → asserts **exactly one** row (criterion 2)

Verified to be a real regression test: with `src/proxy.ts` reverted to its
pre-fix state the success case fails with `Expected: 0, Received: 1`.

Rows are keyed by a unique `Relay.Success.${Date.now()}` title and deleted in
`afterEach`, since the subprocess writes to the real `data/bot_data.sqlite`.

### 4. `CHANGELOG.md` — new `[4.42.25]` entry

Patch bump per `.agents/workflows/rules.md` step 3 — bug fix, no API change.
Entry under `### Fixed`, describing the double-write and the dropped
NZBGet/qBittorrent notifications.

### 5. Spec-file audit (`rules.md` steps 1–2, 4)

- `TECHNICAL_SPEC.md` documents the webhook endpoints but not the proxy's relay
  or who writes `media_events`. Add a short line under the webhook section
  recording that the bot is the sole writer on the happy path and the proxy
  writes only as an offline fallback.
- `FUNCTIONAL_SPEC.md` — no user-facing behaviour change expected; audit and
  leave unchanged unless it describes notification delivery in a way this
  contradicts.
- `src/verify-config.ts` — no new env vars, no new check needed (confirm only).

## Test plan

```bash
bun test src/services/__tests__/webhook_relay_dedup.test.ts   # new tests
bun test                                                      # full suite, no regressions
bun run check:bot-parse                                       # bundle parses
```

Existing suites that must stay green: `media_events.test.ts`,
`webhook_fanout.test.ts`, `radarr_sonarr_webhooks.test.ts`,
`qbittorrent_webhook.test.ts`, `webhooks.test.ts`, `eventQueue.test.ts`.

`.agents/AGENTS.md`: the bot is never launched locally at any point. The proxy is
not restarted either — that happens on deploy, which is out of scope here.

## Commit plan

Per `.agents/workflows/commits.md`, run `bunx chowa commit` to cluster, then
commit each cluster separately. Expected clusters:

1. `fix(proxy): write media_events only when the relay to the bot fails`
   — `webhookParser.ts`, `proxy.ts`, new test file
2. `docs(specs): add spec and plan for proxy media_events double-write`
   — `specs/`, `CHANGELOG.md`, `TECHNICAL_SPEC.md`

Nothing is pushed without explicit approval — the installed `pre-push` hook
auto-deploys and `kill -9`s bot processes.

## Out of scope (unchanged from spec)

`BRAIN_WEBHOOK_URL` correction, NZBGet extension script, qBittorrent completion
hook, `verify-config.ts` reachability probe, historical duplicate-row cleanup.
