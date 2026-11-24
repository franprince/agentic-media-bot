# Specs Index

Specification-driven changes, newest first. Each row links to a directory
containing `spec.md` (Stage 1) and `implementation_plan.md` (Stage 2).

| Date | Slug | Summary | Status |
|---|---|---|---|
| 2026-11-24 | [claude-all-tools](./2026-11-24-claude-all-tools/) | With Claude, send every tool and the full prompt on every request instead of routing tool groups per message; fixed cache prefix; an evaluation of tool choice comes first | Approved — evaluation done, not built |
| 2026-11-24 | [claude-context](./2026-11-24-claude-context/) | With the Claude provider: send recent turns uncompacted, start a new conversation after a 12-hour gap, log cache and timing per call; for every provider, answer plainly when no tool covers a request instead of leaking `NEED_MORE_TOOLS` | Done — `4.48.0` |
| 2026-11-14 | [token-budget](./2026-11-14-token-budget/) | Send only the tools, prompt sections and history a message needs so the bot fits hosted free tiers (Groq, 8k tokens/min); `OLLAMA_API_KEY`, 429 handling, recommendations fallback | Done — `4.46.0` |
| 2026-08-06 | [ersatztv-integration](./2026-08-06-ersatztv-integration/) | Integrate ErsatzTV status monitoring, daily EPG guide queries, and a Channel Director skill for parameter-driven IPTV channel programming | Draft |
| 2026-08-06 | [mechanical-skill-extraction-pilot](./2026-08-06-mechanical-skill-extraction-pilot/) | Extract `service-health`/`download-queue` tools into `media-tools` skills consumed via the existing Tailscale proxy bridge, and add an Ollama-backed Step 0 intent classifier ahead of the cloud tool loop | Draft |
| 2026-08-02 | [generic-distribution-onboarding](./2026-08-02-generic-distribution-onboarding/) | Document all 17 code-referenced env vars missing from `.env.example`, extend `setup.ts` prompts, and clarify the single-household scope for third-party self-hosters | Done — `4.43.2` |
| 2026-08-02 | [nzbget-extension-script](./2026-08-02-nzbget-extension-script/) | Add the NZBGet extension script that makes `/nzbget-webhook` reachable at all — NZBGet has no native webhooks, so the endpoint had never once been called | Done — `4.43.0` |
| 2026-08-01 | [proxy-media-event-double-write](./2026-08-01-proxy-media-event-double-write/) | Stop `proxy.ts` and the bot both writing `media_events`, which silently drops NZBGet/qBittorrent notifications via the 60s dedup window | Done — `4.42.25` |
