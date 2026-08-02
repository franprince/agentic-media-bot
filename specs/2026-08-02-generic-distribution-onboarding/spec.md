# Spec — Harden onboarding/config for third-party self-hosters

**Date:** 2026-08-02
**Slug:** `generic-distribution-onboarding`
**Status:** Approved — implemented in `4.43.2`

## Problem statement

The bot's integration layer (`src/services/*.ts`, `src/agent/tools/*.ts`) is
already generic across arr-stack setups: Radarr/Sonarr quality profiles and
root folders are optional params that fall back to whatever the connected
instance reports as default (`src/agent/tools/radarr-tools.ts:286-287`,
`sonarr-tools.ts:258-260`) — nothing about a specific person's library is
hardcoded there.

The gap is onboarding, not architecture. A diff of every `process.env.X`
referenced in `src/` against what `.env.example` documents shows 17 vars the
code reads that a third-party self-hoster would never learn about from the
example file or README:

| Var | Purpose | Consumed at |
|---|---|---|
| `AI_MODEL`, `AI_MODEL_CAPABLE`, `AI_MODEL_FAST` | model selection overrides | `src/agent/index.ts` |
| `TMDB_READ_ACCESS_TOKEN` / `TMDB_READ_API_KEY` | poster/metadata lookups | `src/services/tmdb.ts:164-185` |
| `TRANSCRIPTION_URL`, `TRANSCRIPTION_MODEL`, `TRANSCRIPTION_API_KEY` | voice message transcription | `src/services/transcription.ts` |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL` | Whisper-compatible transcription fallback (**not** an `AI_PROVIDER` chat option — `agent/index.ts:117` only branches on `"ollama"` vs. default Google) | `src/services/transcription.ts:24,82` |
| `USE_PLEX_WEBHOOK`, `WEBHOOK_PORT` | Plex webhook receiver toggle/port | `src/bot.ts:78,96`, `src/setup.ts:177-178` |
| `WEBHOOK_NOTIFY_CHAT_ID` | override fan-out target (docs say all `ALLOWED_USER_IDS` get notified by default — `BACKLOG.md`, "Multi-user notification scoping", shipped 4.36.0) | `src/services/webhooks.ts:23-30` |
| `PROXY_PORT` | proxy listen port | `src/proxy.ts:28` |
| `DASHBOARD_TOKEN` | auth for the proxy's `/api/*` dashboard routes — `verify-config.ts` warns at startup if unset, but a first-time reader has no way to know the var exists before that warning fires | `src/proxy.ts:85-92`, `src/verify-config.ts:163-172` |
| `BOT_RESTART_COMMAND` | custom restart command override | `src/bot/utils.ts:40` |

Separately, `.env.example:57-58` has two stray incomplete lines
(`PLEX_MOVIE_SECTION_IDS` / `PLEX_SHOW_SECTION_IDS` with no `=value`) left
over from prior editing — duplicates of the already-correct lines at 50-51.

The single-tenant model (one `.env` → one arr stack, shared by every Telegram
ID in `ALLOWED_USER_IDS`) is already correct and already documented as a
deliberate choice (`BACKLOG.md` "Multi-user notification scoping"); this spec
does not change that model, only makes it and its knobs discoverable.

## Goals

1. `.env.example` documents every env var the running code actually reads
   (the 17 above), grouped and commented so a third party understands what's
   required vs. optional vs. feature-gated, and the stray duplicate lines at
   57-58 are removed.
2. `src/verify-config.ts` is confirmed to cover every var from the table
   above — on inspection it already checks TMDB, transcription,
   `DASHBOARD_TOKEN`, and webhook config (`verify-config.ts:163-293`), so
   this is a verification/audit pass, not new checks from scratch. Fill in
   whatever the audit actually finds missing.
3. README.md's setup section is accurate for a third party standing up their
   own arr stack from scratch: it should point at `.env.example`/`setup.ts`
   as the source of truth rather than re-listing a partial var subset, and
   should state plainly that this is a single-household bot (one shared arr
   stack, multiple allowed Telegram users) — not a multi-tenant/SaaS tool —
   so newcomers don't misjudge the scope.
4. `src/setup.ts`'s interactive flow prompts for (or explicitly explains
   skipping) every *commonly-used* optional feature — TMDB, transcription,
   dashboard auth — not just the currently-covered core services, so a
   first-time run doesn't silently leave features half-configured.

## Non-goals

- No chat-platform abstraction. Telegram-only via `grammy` stays as-is —
  confirmed intentional.
- No multi-tenant/SaaS redesign (per-user credential storage, multiple
  independent arr stacks behind one bot instance). Single `.env` per
  deployment remains the model; this spec only documents it clearly.
- No changes to the Brain/Proxy Tailscale split — it's optional
  (`USE_PROXY=false` default) and already off the critical path for a
  single-LAN self-hoster.
- No behavior changes to `src/agent/tools/*.ts` or `src/services/*.ts`
  integration logic — this is a docs/config-surface pass only.

## Edge cases

- A var that's genuinely internal/derived (none currently reviewed appear to
  be) should stay undocumented rather than padding `.env.example` with noise
  — but every var found in the audit table above is user-facing config, so
  this is not expected to trim the list.
- `AI_PROVIDER=openai` is not a real option today (only `google`/`ollama`
  branch in `agent/index.ts`) — `.env.example` and README must not imply it
  is; `OPENAI_*` vars are transcription-only and should be documented under
  that feature, not under `AI_PROVIDER`.
- `verify-config.ts` additions must not turn optional/feature-gated vars
  (TMDB, transcription, dashboard token) into hard failures — they should
  warn-if-partially-set (e.g. `TRANSCRIPTION_URL` set but no matching
  key) and stay silent/skip when a feature is simply unused, matching the
  existing pattern for `USE_PLEX_WEBHOOK` (`verify-config.ts:179-181`).
- `verify-config.ts:70-89` ("OpenAI/OpenRouter Connectivity") checks
  `AI_PROVIDER === "openai"`, but `agent/index.ts:117` only branches on
  `AI_PROVIDER === "ollama"` — anything else, including `"openai"`, silently
  falls through to Google. The check can pass while the agent never actually
  routes chat requests through OpenAI. Per user decision, this is
  **documented, not fixed**: no behavior change to `agent/index.ts` (stays a
  non-goal), the gap gets a note in `TECHNICAL_SPEC.md` and a `BACKLOG.md`
  entry, and `.env.example`/README must not imply `AI_PROVIDER=openai` is a
  supported chat-provider value.

## Acceptance criteria

- [ ] `comm -23 <(grep -rhoE 'process\.env\.[A-Z_]+' src/ | sed 's/process\.env\.//' | sort -u) <(grep -oE '^[A-Z_]+=' .env.example | sed 's/=//' | sort -u)` returns only `HOME`/`PATH` (system env vars, not app config) — i.e. zero app-config gaps remain.
- [ ] `.env.example` has no stray/incomplete lines (`bun run` or manual read confirms every line is either a comment or `KEY=value`).
- [ ] `bun run verify-config` (or equivalent existing script) surfaces a check for each newly-documented optional feature.
- [ ] README.md explicitly states the single-household/shared-arr-stack model.
- [ ] Existing test suite and lint/build pass unchanged (`bun test`, project's lint/build scripts) — this is a config/docs pass, no test behavior should change.
