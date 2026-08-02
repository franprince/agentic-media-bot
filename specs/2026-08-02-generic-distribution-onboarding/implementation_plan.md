# Implementation Plan — Harden onboarding/config for third-party self-hosters

**Spec:** [`spec.md`](./spec.md)
**Branch:** `docs/generic-distribution-onboarding` (from `master`)
**Status:** Approved — implemented in `4.43.2`

This is a config/docs-surface pass. No changes to `src/services/*.ts`,
`src/agent/tools/*.ts`, or `agent/index.ts` model-selection logic.

## Files

### 1. `.env.example` — rewrite

Reorganize into commented sections so required-vs-optional is visible at a
glance, and add every var from the spec's gap table. Keep existing
required vars (`TELEGRAM_BOT_TOKEN`, `RADARR_*`, `SONARR_*`, `QBITTORRENT_*`,
`NZBGET_*`, `PLEX_*`, `ALLOWED_USER_IDS`) where they are.

New sections to add:

- **AI model overrides** (optional): `AI_MODEL`, `AI_MODEL_CAPABLE`,
  `AI_MODEL_FAST` — comment that these override the per-provider default
  model names; `AI_PROVIDER` comment stays `Options: google, ollama` (do
  **not** add `openai` — per spec, that's a documented gap, not a supported
  value).
- **TMDB (optional)**: `TMDB_READ_ACCESS_TOKEN`, `TMDB_READ_API_KEY` —
  comment: powers `discoverMedia` recommendations; unset disables the
  feature, doesn't break the bot.
- **Voice transcription (optional)**: `TRANSCRIPTION_URL`,
  `TRANSCRIPTION_MODEL`, `TRANSCRIPTION_API_KEY`, `OPENAI_API_KEY`,
  `OPENAI_BASE_URL` — comment explaining these are a Whisper-compatible
  fallback chain for voice-message transcription specifically, independent
  of `AI_PROVIDER`.
- **Webhook server (optional)**: move `USE_PLEX_WEBHOOK`, add `WEBHOOK_PORT`
  (default `3000`), `WEBHOOK_NOTIFY_CHAT_ID` (comment: overrides fan-out to
  all `ALLOWED_USER_IDS`).
- **Proxy Gateway (optional, split-deployment only)**: existing
  `USE_PROXY`/`PROXY_URL`/`PROXY_SECRET_KEY`/`BRAIN_WEBHOOK_URL`, add
  `PROXY_PORT` (default `3001`), `DASHBOARD_TOKEN` (comment: auth for the
  proxy's `/api/*` dashboard routes; unset = open to anyone on the network).
- **Misc**: `BOT_RESTART_COMMAND` (comment: override for the systemd
  restart command `verify-config`/admin restart flow shells out to).

Delete the stray duplicate lines at the current end of the file
(`PLEX_MOVIE_SECTION_IDS` / `PLEX_SHOW_SECTION_IDS` with no `=value`).

Add a one-line header comment above the whole file: *"This bot is designed
for one household: a single arr stack shared by every Telegram ID in
ALLOWED_USER_IDS. It is not multi-tenant — it does not support multiple
independent arr stacks from one running instance."*

### 2. `src/verify-config.ts` — audit, likely no code change

Re-run the diff from the spec against the final `.env.example` var list.
Confirmed already covered: TMDB (248-262), transcription (264-293),
`DASHBOARD_TOKEN` (163-174), webhook config (177-190), proxy (150-161),
`ALLOWED_USER_IDS` (137-148). Expected outcome: no new checks needed, this
step is verification that the audit table is now fully accounted for. If
the audit turns up a real gap, add a check following the existing pattern
(warn-and-continue for optional features, matching `USE_PLEX_WEBHOOK`'s
skip-if-disabled shape at line 179-181).

No change to the `AI_PROVIDER === "openai"` check at lines 70-89 — left
as-is per the documented-not-fixed decision (see file #5 below).

### 3. `README.md` — edit setup section

- Replace the manual "Finding your tokens" var-by-var listing (lines 53-63)
  with a pointer: *"See `.env.example` for the full list of variables,
  grouped by required vs. optional. `bun src/setup.ts` walks through the
  required ones interactively."* Keep the token-finding how-tos (BotFather,
  Plex token XML method) since those are genuinely useful and not
  duplicated elsewhere — trim the var list, not the instructions.
- Add a short "Scope" note near the top (after the feature list, before
  "Getting Started"): this is a single-household bot — one bot instance
  connects to one arr stack; every allowed Telegram user shares that same
  library and download queue. Not a multi-tenant/SaaS tool.

### 4. `src/setup.ts` — extend interactive flow

Insert an optional-features section after the existing Webhook Setup block
(after line 185, before "Startup Configuration"):

```
console.log("\n--- 🎬 Optional Features ---");
```

- **TMDB**: prompt y/n "Enable TMDB-powered recommendations?"; if yes,
  prompt for `TMDB_READ_ACCESS_TOKEN` (link to TMDB API settings page in the
  preceding console.log, same pattern as the existing Plex token
  instructions).
- **Voice transcription**: prompt y/n "Enable voice message transcription?";
  if yes and `AI_PROVIDER` is `google`, explain it reuses
  `GOOGLE_GENERATIVE_AI_API_KEY` already collected — no further prompt
  needed. If `ollama`, explain it reuses `OLLAMA_BASE_URL`. Only prompt for
  `TRANSCRIPTION_URL` if the user wants to point at neither (explicit
  self-hosted Whisper endpoint).
- **Dashboard auth**: prompt y/n "Set a dashboard auth token?" (only ask if
  `USE_PROXY` — dashboard lives behind the proxy); if yes, either prompt for
  a value or offer to generate one with `crypto.randomUUID()`.

Each block: if the user declines, do not write the key to `config` at all
(matches existing pattern — e.g. declining webhooks just sets
`USE_PLEX_WEBHOOK=false` and skips the rest), so the resulting `.env.local`
stays minimal rather than padded with empty keys.

### 5. `TECHNICAL_SPEC.md` — document the openai gap and onboarding scope

- Under "Startup Verification & Specification Auditing" (after line 113,
  the existing "Audio Transcription Provider check" bullet), add: *"**Known
  gap**: `verify-config.ts`'s 'OpenAI/OpenRouter Connectivity' check
  validates `OPENAI_API_KEY` when `AI_PROVIDER=openai`, but the agent's
  model selection (`agent/index.ts`) only branches on `ollama` vs. default
  Google — `openai` as an `AI_PROVIDER` value is not actually wired to chat
  responses today. Documented here rather than fixed; do not advertise
  `openai` as a supported `AI_PROVIDER` value in `.env.example` or `README`
  until this is resolved."*
- Under "Onboarding & Configuration" (after line 121), add a bullet:
  *"**Single-tenant model**: one running bot instance serves one arr stack,
  shared by every ID in `ALLOWED_USER_IDS`. There is no per-user credential
  storage or multi-stack routing."*

### 6. `BACKLOG.md` — add entry

New entry under `🟡 P2 — Backlog` (matches severity of existing entries
like "Web dashboard authentication"):

```
### AI_PROVIDER=openai not wired to chat agent
**Problem:** `verify-config.ts` has a passing connectivity check for
`AI_PROVIDER=openai`, but `agent/index.ts` never routes chat requests
through it — only `ollama` is branched, everything else silently uses
Google. A user who sets `AI_PROVIDER=openai` gets a green checkmark at
startup and then Gemini responses.
**Fix:** Either add a real OpenAI branch to `agent/index.ts`'s model
selection, or remove the misleading verify-config check.
**Status:** 🟡 Open — documented in `TECHNICAL_SPEC.md`, not yet fixed.
```

### 7. `CHANGELOG.md` / `package.json` — version bump

Patch bump (docs/config only, no behavior change): current `4.43.1` →
`4.43.2`. Standard `### Changed`/`### Fixed` entries per existing format,
summarizing the `.env.example` gap fix and onboarding doc updates.

## Test plan

This is docs/config; no new unit tests. Verification:

```bash
# Every code-referenced var is now documented (only HOME/PATH should remain)
comm -23 \
  <(grep -rhoE 'process\.env\.[A-Z_]+' src/ | sed 's/process\.env\.//' | sort -u) \
  <(grep -oE '^[A-Z_]+=' .env.example | sed 's/=//' | sort -u)

# No stray incomplete lines in .env.example
grep -vE '^(#.*|[A-Z_]+=.*|)$' .env.example   # expect no output

bun test           # full existing suite unaffected
bun run build       # or project's equivalent — confirm setup.ts/verify-config.ts still typecheck/bundle
```

Manual check (not automatable): run `bun src/setup.ts` interactively once
to confirm the new optional-feature prompts flow correctly and declining
each one still produces a working minimal `.env.local` — ask before running
since it writes a local file and may prompt for real credentials.

## Commit plan

1. `docs(config): document all env vars in .env.example and remove stray lines`
   — `.env.example`
2. `feat(setup): prompt for TMDB, transcription, and dashboard auth in setup.ts`
   — `src/setup.ts`
3. `docs: clarify single-household scope and document AI_PROVIDER=openai gap`
   — `README.md`, `TECHNICAL_SPEC.md`, `BACKLOG.md`
4. `docs(specs): add spec and plan for onboarding hardening`
   — `specs/2026-08-02-generic-distribution-onboarding/`, `specs/INDEX.md`
5. `chore(release): 4.43.2` — `CHANGELOG.md`, `package.json`

(Step 2 split from step 1 since one is example-file docs and the other is
interactive-flow behavior — different logical changes even though both
touch "config onboarding.")

Not pushed without approval — matches `AGENTS.md`: the bot is never run or
restarted locally, and this repo's `pre-push` hook auto-deploys.

## Out of scope

Wiring `AI_PROVIDER=openai` to the agent (documented, not fixed, per user
decision). Multi-tenant credential storage. Any chat-platform work.
Brain/Proxy Tailscale topology changes. Changes to
`src/agent/tools/*.ts`/`src/services/*.ts` integration behavior.
