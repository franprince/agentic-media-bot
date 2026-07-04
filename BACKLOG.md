# 🗂️ Agentic Media Bot — Feature Backlog

> Living document. Updated as work progresses.
> Priority tiers: 🔴 P0 (critical/bugs) · 🟠 P1 (next quarter) · 🟡 P2 (backlog)

---

## 🔴 P0 — Bugs & Critical Gaps

### `/plex` command shows `Invalid Date` for all events
**Root cause:** `saveMediaEvent` stores timestamp with SQLite `datetime('now') || 'Z'` → produces `2026-07-03 19:00:00Z` (space, not `T`). `bot.ts` then appends another `"Z"`, making it unparseable.  
**Fix:** Store ISO-8601 with `T` separator in DB, parse robustly in rendering functions.  
**Status:** ✅ Fixed in v4.35.0

---

### `/plex` command shows duplicate events (e.g. `library.new` x2)
**Root cause:** Plex fires `library.new` once per matching library section. Each fires the webhook independently, both get logged.  
**Fix:** Deduplicate on insert: skip if the same `(service, event_type, title)` was already saved within the last 60 seconds.  
**Status:** ✅ Fixed in v4.35.0

---

### Quality shows `undefined` on Radarr `Grab` events
**Root cause:** Radarr `Grab` webhook `release.quality` can be a nested `{ quality: { name } }` object. Only `Download` had the unwrapping logic.  
**Fix:** Apply same nested-object unwrapping to `Grab` quality extraction.  
**Status:** ✅ Fixed in v4.35.0

---

### Multi-user notification scoping
**Problem:** All webhooks notify `WEBHOOK_NOTIFY_CHAT_ID` — a single hardcoded target.  
**Fix:** Fan out webhook notifications to all subscribers (`ALLOWED_USER_IDS`). `WEBHOOK_NOTIFY_CHAT_ID` still overrides to a single target for backward compatibility.  
**Status:** ✅ Shipped in v4.36.0

---

### Bulk torrent pause/resume
**Problem:** "Pause everything" loops one tool call per torrent.  
**Fix:** Added `pauseAllTorrentsTool` / `resumeAllTorrentsTool` using qBittorrent `hashes=all` API.  
**Status:** ✅ Shipped in v4.36.0

---

## 🟠 P1 — High-Value Features

### Pre-computed download progress
**Problem:** Queue tools return raw bytes; LLM sometimes miscalculates.  
**Fix:** Compute `progressPercent`, `downloadedGB`, `totalGB`, `etaHuman` in tool execute.  
**Status:** 📋 Backlog

---

### Timezone-aware ETA & date formatting
**Problem:** `getTimezone()` exists but is never used for formatting.  
**Fix:** Use stored timezone in all date rendering: event history, webhook messages, ETA.  
**Status:** 📋 Backlog

---

### Plex cross-check on search results (auto-flag "already in library")
**Problem:** LLM often skips the Plex cross-check step after Radarr search.  
**Fix:** Auto-enrich search results with `alreadyInPlex: true` flag inside the tool.  
**Status:** 📋 Backlog

---

### Sonarr per-season monitoring
**Problem:** `addSeriesTool` always monitors all seasons.  
**Fix:** Add optional `seasons: number[]` param and prompt user when a season is mentioned.  
**Status:** 📋 Backlog

---

### Plex "Now Playing" live sessions tool
**Problem:** No tool to query active playback sessions.  
**Fix:** Add `getPlexSessionsTool` using Plex `/status/sessions` endpoint.  
**Status:** 📋 Backlog

---

### Disk space awareness & alerting
**Problem:** Disk usage shown only during add-media confirmation; no proactive alerts.  
**Fix:** Add `getDiskSpaceTool`; optionally alert when free space drops below threshold.  
**Status:** 📋 Backlog

---

### Radarr/Sonarr tags support
**Problem:** Tags silently dropped when adding media.  
**Fix:** Expose optional `tags` param in add tools.  
**Status:** 📋 Backlog

---

### Watchlist / "Add for later"
**Problem:** No lightweight way to save titles without triggering a download.  
**Fix:** SQLite `watchlist` table; bot adds/lists items on request.  
**Status:** 📋 Backlog

---

## 🟡 P2 — Backlog

### Web dashboard authentication
**Problem:** Proxy dashboard has no auth — security risk in VPS/cloud deployments.  
**Fix:** Opt-in `DASHBOARD_TOKEN` bearer-token auth on all `/api/*` proxy endpoints. Set `VITE_DASHBOARD_TOKEN` in the UI build to pass the token automatically.  
**Status:** ✅ Shipped in v4.36.0

---

### Voice message transcription
**Problem:** Voice notes are silently ignored.  
**Fix:** Transcribe via Whisper/Gemini Audio and route to agent.  
**Status:** 📋 Backlog

---

### Scheduled / recurring reports
**Problem:** All reports are on-demand only.  
**Fix:** Cron subscriptions in SQLite using existing `node-cron` dependency.  
**Status:** 📋 Backlog

---

### Plex user rating via chat
**Problem:** Can't set a Plex rating from Telegram.  
**Fix:** Tool using Plex `/library/metadata/{id}/userRating` endpoint.  
**Status:** 📋 Backlog

---

### Multi-family Plex user differentiation in notifications
**Problem:** Plex `Account.title` not mapped to Telegram user names in notifications.  
**Fix:** DB mapping Plex usernames → Telegram names.  
**Status:** 📋 Backlog

---

### `/changelog` command for all users
**Problem:** Changelog on startup is admin-only.  
**Fix:** `/changelog` command showing last 3 releases for all allowed users.  
**Status:** 📋 Backlog
