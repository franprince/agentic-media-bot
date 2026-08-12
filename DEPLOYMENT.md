# Deployment Topology

How this system is actually wired. Rewritten 2026-08-10 when the bot moved
from a remote Coolify VPS to running entirely on this machine (see
`specs/` for the earlier remote setup if you need the history).

## The one host

```
┌────────────────────────────────────────────┐
│ Local  "fedora"                             │
│ Media stack + bot                           │
│ LAN 192.168.1.120                           │
│                                              │
│  • bot.ts (agentic-media-bot)   :3010       │
│  • Radarr                       :7878       │
│  • Sonarr                       :8989       │
│  • Plex                         :32400      │
│  • NZBGet                       :6789       │
│  • qBittorrent                  :8080       │
└────────────────────────────────────────────┘

        Telegram (long polling)
        ▲
        └── the bot polls; no webhook is registered
```

Everything runs on one machine now. The bot talks to Radarr, Sonarr, Plex,
qBittorrent, and NZBGet directly over `localhost` — no Tailscale hop, no
relay, no split-brain.

## Webhook flow, end to end

```
Radarr/Sonarr/Plex/NZBGet
        │  POST directly to the bot
        ▼
   bot.ts :3010 (WEBHOOK_PORT)
        │
        ▼
   Telegram message
```

`WEBHOOK_PORT=3010` (not 3000) — chosen to avoid a known conflict where an
unrelated local Next.js dev server sometimes binds port 3000. If you ever
change it, update it in **four** places: `.env.local`, Radarr's Webhook
notification, Sonarr's Webhook notification, and NZBGet's
`AgenticMediaBot:WebhookUrl` extension setting.

Configured webhook targets (as of 2026-08-10):
- Radarr → `http://localhost:3010/radarr-webhook`
- Sonarr → `http://localhost:3010/sonarr-webhook`
- NZBGet → `http://localhost:3010/nzbget-webhook` (extension setting, in
  `/config/nzbget.conf` inside the `nzbget` podman container — the NZBGet
  WebUI's "Save" button on Settings didn't persist this reliably; editing
  the config file and calling the `reload` JSON-RPC method did)
- Plex → **not verified**. Plex webhooks are account-level (Settings →
  Webhooks in the Plex web app, requires Plex Pass) and aren't exposed
  through the local server API, so this wasn't checked or changed
  programmatically. If Plex was pointed at the old proxy
  (`http://localhost:3001/plex-webhook`) or the old Coolify address, repoint
  it to `http://localhost:3010/plex-webhook` by hand.
- qBittorrent → never configured a webhook (per the old `DEPLOYMENT.md`,
  zero `qbittorrent` rows ever recorded). Still not addressed here.

## Local services

Managed as **rootless podman** containers via systemd user units in
`/home/fran/Documentos/media-stack/` (`container-*.service`), plus:

| unit | state | notes |
|---|---|---|
| `agentic-media-bot.service` | **enabled, running** | `bun bot.js`, port 3010. This is now the only bot instance anywhere. |
| `agentic-media-proxy.service` | **disabled, stopped** | Retired, not deleted — see below. |

### The proxy is retired, not deleted

`proxy.ts`, the `agentic-media-proxy.service` unit, and the
`USE_PROXY`/`PROXY_URL`/`PROXY_SECRET_KEY` env vars all still exist. They
existed to bridge a remote bot (Coolify VPS) to LAN-only services over
Tailscale, and to relay webhooks from the LAN to that remote bot. With the
bot running locally, neither job is needed:

- **Tool calls**: `src/agent/proxyClient.ts`'s `isProxyEnabled()` checks
  `USE_PROXY === "true"`. It's `false` in `.env.local`, so the bot calls
  Radarr/Sonarr/Plex/qBittorrent/NZBGet directly — no code change was
  needed for this, it already worked this way when unset.
  `BRAIN_WEBHOOK_URL` (the old relay target) is now unused and was removed
  from `.env.local`.
- **Webhook relay**: not needed since the bot itself listens on
  `WEBHOOK_PORT` and the *arr apps were repointed straight at it (see
  above).

If a remote-brain setup is ever wanted again: set `USE_PROXY=true` and
`PROXY_URL`, start `agentic-media-proxy.service`, and repoint the *arr
webhooks back at the proxy. The old proxy dashboard UI (`proxy-ui/`) still
builds and deploys alongside it.

## The old Coolify deployment

The bot used to auto-deploy to a Coolify-managed VPS on every push to
`master` (Coolify's own webhook, configured in Coolify's UI — nothing in
this repo). That instance is being decommissioned:

- **Not done by this change** (no access to the Coolify UI/API from here):
  pause or delete the app in Coolify so it stops polling/holding Telegram's
  long-polling lock. **Do this manually before running the local bot**, or
  you'll get Telegram 409 conflicts between the two instances.
- The Coolify VPS was already unreachable at `BRAIN_WEBHOOK_URL` before this
  change (`ConnectionRefused` in the proxy's logs), so it may already be
  down. Confirm either way before starting the local bot.
- `Dockerfile` and `.github/workflows/ci.yml` are left in place in case
  container-based deployment is wanted again later; they're just unused by
  the current local-systemd setup.

## Deploying (local)

`scripts/deploy-to-media-stack.sh` builds `bot.js` (and `proxy.js`, though
the latter isn't restarted by default) plus the proxy UI, copies them into
`/home/fran/Documentos/media-stack/bot/`, and restarts
`agentic-media-bot`.

A `pre-push` git hook (installed by `scripts/install-hooks.sh`) runs that
deploy automatically on every push. It no longer kills local bot processes
before deploying — the local bot *is* the production instance, so
`deploy-to-media-stack.sh` restarting it via `systemctl` is the update
mechanism, not a kill-then-relaunch dance.

## Verifying each hop

```bash
# 1. Is the bot up and healthy?
curl -s localhost:3010/health              # {"status":"ok","timestamp":...}

# 2. Is anything polling Telegram? (no webhook registered = long polling)
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"

# 3. What has actually been recorded?
sqlite3 /home/fran/Documentos/media-stack/bot/data/bot_data.sqlite \
  "SELECT service, event_type, COUNT(*), MAX(timestamp)
     FROM media_events GROUP BY service, event_type ORDER BY service;"
```

Do **not** call Telegram's `getUpdates` to test this — if the bot is
long-polling, that call 409-conflicts with it and can make it exit. This
matters more now, not less: there's only one instance, and it's the one
you'd be knocking offline.

## Diagnostic notes worth keeping

- `media_events` rows reveal *which* process wrote them: the proxy
  historically wrote the raw event type (`Download`), the bot writes
  lowercase (`download`). With the proxy retired, only lowercase rows
  should appear going forward — an uppercase row means something is still
  talking to the old proxy path.
- Zero rows for a service means its webhooks have **never** arrived — a
  configuration gap, not a delivery bug. That's how the qBittorrent gap was
  found, and it's still open.
