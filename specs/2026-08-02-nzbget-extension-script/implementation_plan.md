# Implementation Plan — NZBGet extension script

**Spec:** [`spec.md`](./spec.md)
**Branch:** `feat/nzbget-extension-script` (from `master` @ `7fa4339`)
**Status:** Approved — implemented in `4.43.0`

## Layout

The extension is version-controlled in this repo and *copied* into NZBGet's
ScriptDir. It is not authored in place — `media-stack/nzbget/config/` is runtime
state in a different repo.

```
extensions/nzbget/AgenticMediaBot/
├── manifest.json      # NZBGet v23+ extension descriptor
└── main.sh            # bash + curl, the whole implementation
```

Installed to `…/media-stack/nzbget/config/scripts/AgenticMediaBot/` (which maps
to `/config/scripts/AgenticMediaBot` inside the container).

`extensions/` is a new top-level directory: this is not bot source, it does not
belong under `src/`, and it must not be picked up by `bun test` or the bundler.

## Files

### 1. `extensions/nzbget/AgenticMediaBot/manifest.json` — new

```json
{
  "main": "main.sh",
  "name": "AgenticMediaBot",
  "kind": "QUEUE/POST-PROCESSING",
  "displayName": "Agentic Media Bot",
  "version": "1.0",
  "nzbgetMinVersion": "23.0",
  "queueEvents": "NZB_ADDED",
  "about": "Notifies the Agentic Media Bot when downloads are queued and completed.",
  "options": [
    { "name": "WebhookUrl", "displayName": "WebhookUrl",
      "value": "http://localhost:3001/nzbget-webhook", "description": [...], "select": [] },
    { "name": "Timeout", "displayName": "Timeout",
      "value": 10, "description": [...], "select": [] }
  ]
}
```

Field shapes follow the `nzbgetcom` reference extensions (`Extension-EMail`,
`Extension-Completion`). Options surface to the script as `NZBPO_WEBHOOKURL` and
`NZBPO_TIMEOUT`.

### 2. `extensions/nzbget/AgenticMediaBot/main.sh` — new (executable)

Single `bash` script handling both roles, dispatching on which env vars NZBGet
set:

```
if   NZBNA_EVENT == NZB_ADDED   → post "added"   "$NZBNA_NZBNAME"  ; exit 0
elif NZBPP_TOTALSTATUS is set   → SUCCESS ? post "success" "$NZBPP_NZBNAME"; exit 93
                                          : exit 95
else                            → exit 95        # invoked with neither (UI test)
```

Details:

- **JSON escaping** (spec edge case 2) — a `json_escape` helper escapes `\` and
  `"` and strips control characters, so titles containing quotes or non-ASCII
  (`キャプテン翼`) produce a valid body. No naive interpolation.
- **Never fail a download** (goal 4) — the `curl` call is wrapped so a non-zero
  exit or non-2xx status logs a warning and falls through to `exit 93`.
- **Bounded** — `curl --max-time "$TIMEOUT" --silent --show-error`, so a hung
  proxy can't stall the queue.
- **Defaults** — `WebhookUrl`/`Timeout` fall back to the manifest values if the
  `NZBPO_*` vars are absent, so the script is runnable standalone for testing.
- Output goes to stdout, which NZBGet captures into its log.

### 3. `extensions/nzbget/README.md` — new

Install steps (copy the folder into ScriptDir, reload Settings, add
`AgenticMediaBot` to `Extensions`), the option reference, and how to verify.
Records that enabling is a manual step: NZBGet only runs extensions listed in
`Extensions`, and `nzbget.conf` is user state this repo does not edit
(spec edge case 6).

### 4. `scripts/install-nzbget-extension.sh` — new (executable)

Repeatable install (goal 5): copies `extensions/nzbget/AgenticMediaBot/` into the
ScriptDir, `chmod +x` the script, and prints the remaining manual enable step.
ScriptDir path overridable by argument, defaulting to the verified
`/home/fran/Documentos/media-stack/nzbget/config/scripts`.

Copy only — it never edits `nzbget.conf` and never restarts the container.

### 5. `src/services/__tests__/nzbget_extension.test.ts` — new

Executes `main.sh` as a subprocess against a stub HTTP server (`Bun.serve` on an
ephemeral port passed via `NZBPO_WEBHOOKURL`), asserting the received body and
the exit code. This tests the real script, not a re-implementation.

| case | env | expect |
|---|---|---|
| queued | `NZBNA_EVENT=NZB_ADDED`, `NZBNA_NZBNAME=X` | body `{"event":"added","title":"X"}` (criterion 2) |
| completed | `NZBPP_TOTALSTATUS=SUCCESS`, `NZBPP_NZBNAME=X` | body `{"event":"success",…}`, exit `93` (criterion 3) |
| failed | `NZBPP_TOTALSTATUS=FAILURE` | no request, exit `95` (criterion 4) |
| unhandled queue event | `NZBNA_EVENT=NZB_DELETED` | no request (spec edge case 3) |
| neither var set | — | no request, exit `95` (edge case 4) |
| tricky title | title `Some "Quoted" キャプテン翼 \ Show` | body parses as JSON, title round-trips exactly (criterion 5) |
| dead endpoint | URL on a closed port | exit `93` (criterion 6) |

Skipped via `test.skipIf` when `bash`/`curl` are unavailable, so CI on a minimal
runner can't break on environment rather than logic.

Criterion 1 (manifest validity) is asserted by parsing `manifest.json` and
checking `kind`, `main`, and `queueEvents`.

### 6. Docs (`.agents/workflows/rules.md` steps 1–4)

- `TECHNICAL_SPEC.md` — document the extension under the webhook section:
  NZBGet emits via an extension script, not natively, and it targets the proxy.
- `FUNCTIONAL_SPEC.md` — NZBGet download notifications become real rather than
  latent; audit and update the notifications list.
- `CHANGELOG.md` — `[4.43.0]`, minor: new integration, no breaking change.
  `package.json` bumped to match.
- `src/verify-config.ts` — no new bot env vars (config lives in NZBGet); confirm
  only, no change.

## Verification

```bash
bun test src/services/__tests__/nzbget_extension.test.ts
bun test                    # full suite
bun run check:bot-parse     # bundle unaffected by the new top-level dir
node -e 'JSON.parse(require("fs").readFileSync("extensions/nzbget/AgenticMediaBot/manifest.json"))'
```

Post-install check (criterion 7) — NZBGet's RPC `config` should report the
extension once the files are in place and Settings reloaded:

```bash
curl -s -u user:pass -d '{"method":"config"}' $NZBGET_URL/jsonrpc | grep -i AgenticMediaBot
```

Installing and enabling touches the live NZBGet container, so I will **ask
before running the installer or changing NZBGet settings** — writing the repo
files is safe, activating them is not.

`.agents/AGENTS.md`: the bot is never launched locally.

## Commit plan

1. `feat(integrations): add NZBGet extension script for download notifications`
   — `extensions/`, `scripts/install-nzbget-extension.sh`, test
2. `docs(specs): add spec and plan for the NZBGet extension script`
   — `specs/`, `TECHNICAL_SPEC.md`, `FUNCTIONAL_SPEC.md`
3. `chore(release): 4.43.0` — `CHANGELOG.md`, `package.json`

Not pushed without approval — the `pre-push` hook auto-deploys.

## Out of scope

`BRAIN_WEBHOOK_URL` (blocks actual delivery; needs the Coolify URL), the
qBittorrent hook, `speed`/`eta` reporting, and notifying on
`WARNING`/`FAILURE`/`DELETED`.
