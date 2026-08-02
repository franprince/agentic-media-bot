# Deployment Topology

How this system is actually wired in production. Written 2026-08-02 after a
notification outage investigation, because none of it was recorded anywhere and
the missing pieces cost real debugging time.

Facts below are marked **verified** (checked directly on 2026-08-02) or
**unconfirmed**. Don't promote an unconfirmed item without re-checking.

## The three hosts

```
┌─────────────────────────────┐         ┌──────────────────────────────────┐
│ VPS  "vps-bc210b05"         │         │ Local  "fedora"                  │
│ Coolify host                │         │ Media stack + proxy              │
│ tailscale 100.125.118.66    │◄───────►│ tailscale 100.103.71.60          │
│                             │ tailnet │ LAN      192.168.1.120           │
│  • Coolify UI      :8000    │         │                                  │
│  • the BOT (bot.ts)         │         │  • proxy.ts            :3001     │
│    behind Coolify's         │         │  • Radarr              :7878     │
│    reverse proxy            │         │  • Sonarr              :8989     │
└─────────────────────────────┘         │  • Plex               :32400     │
                                        │  • NZBGet              :6789     │
        Telegram (long polling)         │  • qBittorrent         :8080     │
        ▲                               └──────────────────────────────────┘
        └── the bot polls; no webhook is registered
```

The bot runs on **Coolify**, deployed automatically from this GitHub repo — a
push to `master` triggers a new deploy. Coolify's configuration lives in
Coolify's own UI, **not in this repo**, which is why grepping for "coolify" here
finds only changelog entries.

The two hosts are joined by **Tailscale** (tailnet `tailbc8096.ts.net`). This is
what lets the remote bot reach local media services that are otherwise
LAN-only.

## Traffic directions — these are easy to confuse

There are two independent paths, and they fail independently:

### 1. Bot → proxy (tool calls) — *outbound from the VPS*

The bot can't reach Radarr/Sonarr/Plex/NZBGet directly; they're on the home LAN.
Instead `src/agent/proxyClient.ts` (`isProxyEnabled()` / `executeOnProxy()`)
calls the local proxy over Tailscale, authenticated with `PROXY_SECRET_KEY`.
Service wrappers such as `src/services/nzbget.ts` branch on this.

Proxy address from the VPS: `http://100.103.71.60:3001`.

### 2. Proxy → bot (webhook relay) — *inbound to the VPS*

Radarr, Sonarr, Plex (and now NZBGet) all POST to the **local proxy**, which
relays each webhook to the bot using `BRAIN_WEBHOOK_URL`
(`src/proxy.ts`, the `-webhook` branch). The bot then sends the Telegram message.

**This is the path that was broken.** `BRAIN_WEBHOOK_URL` was
`http://localhost:3000`, a loopback address that cannot reach the VPS. Every
relayed webhook was delivered to whatever happened to hold local port 3000 — at
the time, an unrelated Next.js dev server.

## Webhook flow, end to end

```
Radarr/Sonarr/Plex/NZBGet
        │  POST
        ▼
   proxy.ts :3001            ← writes media_events ONLY if the relay fails
        │  relay to BRAIN_WEBHOOK_URL
        ▼
   bot on Coolify            ← sole writer of media_events on the happy path
        │
        ▼
   Telegram message
```

Write ownership matters: both processes share `data/bot_data.sqlite`
(`DATA_DIR` is relative to the working directory) and `saveMediaEvent` dedups on
`(service, event_type, title)` within 60s. If both write, the bot's `dbSave()`
returns `false` and `eventQueue` silently skips the notification. See
`specs/2026-08-01-proxy-media-event-double-write/`.

## Local services

Managed as **rootless podman** containers via systemd user units in
`/home/fran/Documentos/media-stack/` (`container-*.service`), plus:

| unit | state | notes |
|---|---|---|
| `agentic-media-proxy.service` | **enabled, running** | `bun proxy.js`, port 3001 |
| `agentic-media-bot.service` | **disabled, dead** | Correct — see below |

`agentic-media-bot.service` exists locally but **must stay disabled**. Running
the bot here would take Telegram's long-polling lock and 409-conflict with the
Coolify instance. This is the rule in `.agents/AGENTS.md`, and it is **current,
not stale** — the remote instance is real.

NZBGet runs with `--network=host`, so from inside that container `localhost` is
the host and the proxy is `http://localhost:3001`.

## Deploying

`scripts/deploy-to-media-stack.sh` builds and copies **only the local proxy**
(plus the UI) into `/home/fran/Documentos/media-stack/bot/`, then restarts
`agentic-media-proxy`. It does **not** deploy the bot — Coolify does that from
the GitHub push.

A `pre-push` git hook (installed by `scripts/install-hooks.sh`) runs that deploy
automatically on every push, and `kill -9`s any local process matching
`bun.*bot\.(js|ts)`.

## Current state / open items

- **`BRAIN_WEBHOOK_URL` is wrong.** Still `http://localhost:3000` in the proxy's
  `.env.local`. Must become the bot's Coolify address. **Unconfirmed:** the exact
  value. The bot is *not* on `100.125.118.66:3000` — that port serves
  `{"status":"OK","uptime":""}`, whereas both the bot and proxy return
  `{"status":"ok","timestamp":…}`. Coolify fronts apps with a reverse proxy, so
  the value is most likely the application's FQDN from Coolify's *Domains*
  setting. Port 80 on the VPS returns 404 without a matching `Host` header,
  which is consistent with that.
- **NZBGet extension not yet enabled.** Files exist (`extensions/nzbget/`), but
  NZBGet only runs extensions listed in its `Extensions` setting. See
  `extensions/nzbget/README.md`.
- **qBittorrent has never sent a webhook** either — zero `qbittorrent` rows ever.
  It needs "Run external program on completion" configured. Not yet addressed.
- **Local port 3000 is contended.** An unrelated Next.js dev server binds it.
  Worth remembering before assuming `localhost:3000` means the bot.

## Verifying each hop

```bash
# 1. Tailnet up, and the VPS peer online?
tailscale status

# 2. Proxy alive locally?
curl -s localhost:3001/health              # {"status":"ok","timestamp":...}

# 3. Is the bot reachable at BRAIN_WEBHOOK_URL?
curl -s "$BRAIN_WEBHOOK_URL/health"        # must show status/timestamp, not uptime

# 4. Are webhooks arriving at the proxy at all?
tail -f /tmp/agentic-media-bot-restart.log   # [WEBHOOK] lines

# 5. What has actually been recorded?
sqlite3 /home/fran/Documentos/media-stack/bot/data/bot_data.sqlite \
  "SELECT service, event_type, COUNT(*), MAX(timestamp)
     FROM media_events GROUP BY service, event_type ORDER BY service;"

# 6. Is anything polling Telegram? (no webhook registered = long polling)
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

Do **not** call Telegram's `getUpdates` to test this. If the Coolify bot is
long-polling, that call 409-conflicts with it and can make the production
instance exit.

## Diagnostic notes worth keeping

- `media_events` rows reveal *which* process wrote them. The proxy historically
  wrote the raw event type (`Download`), the bot writes lowercase (`download`).
  Divergent counts between the two spellings tell you when each was last alive.
- Zero rows for a service means its webhooks have **never** arrived — a
  configuration gap, not a delivery bug. That's how the NZBGet and qBittorrent
  gaps were found.
- `pending_update_count: 0` from `getWebhookInfo` is weak evidence; updates
  expire after 24h, so it doesn't prove a poller exists.
