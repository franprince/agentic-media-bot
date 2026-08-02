# Specs Index

Specification-driven changes, newest first. Each row links to a directory
containing `spec.md` (Stage 1) and `implementation_plan.md` (Stage 2).

| Date | Slug | Summary | Status |
|---|---|---|---|
| 2026-08-02 | [nzbget-extension-script](./2026-08-02-nzbget-extension-script/) | Add the NZBGet extension script that makes `/nzbget-webhook` reachable at all — NZBGet has no native webhooks, so the endpoint had never once been called | Done — `4.43.0` |
| 2026-08-01 | [proxy-media-event-double-write](./2026-08-01-proxy-media-event-double-write/) | Stop `proxy.ts` and the bot both writing `media_events`, which silently drops NZBGet/qBittorrent notifications via the 60s dedup window | Done — `4.42.25` |
