#!/usr/bin/env sh
set -eu

OLD_PID="${1:-}"
BOT_SCRIPT="${2:-src/bot.ts}"
BUN_BIN="${3:-bun}"
LOG_FILE="${4:-/tmp/agentic-media-bot-restart.log}"

if [ -z "$OLD_PID" ]; then
  echo "Missing old pid" >> "$LOG_FILE"
  exit 1
fi

# Ensure any orphaned bun processes running the bot are stopping.
# We use pkill -f to match the script name specifically as a bun argument.
# We avoid killing the restart script itself by being more specific.
echo "[$(date)] Requesting termination of old process $OLD_PID and siblings matching 'bun .* $BOT_SCRIPT'..." >> "$LOG_FILE"
kill "$OLD_PID" 2>/dev/null || true
pkill -f "bun .* $BOT_SCRIPT" 2>/dev/null || true

# Wait up to 10 seconds for shutdown.
ATTEMPTS=50
while kill -0 "$OLD_PID" 2>/dev/null || pgrep -f "bun .* $BOT_SCRIPT" >/dev/null; do
  ATTEMPTS=$((ATTEMPTS - 1))
  if [ "$ATTEMPTS" -le 0 ]; then
    echo "[$(date)] Forced termination (kill -9) required." >> "$LOG_FILE"
    kill -9 "$OLD_PID" 2>/dev/null || true
    pkill -9 -f "bun .* $BOT_SCRIPT" 2>/dev/null || true
    break
  fi
  sleep 0.2
done

echo "[$(date)] Starting new bot instance..." >> "$LOG_FILE"
nohup "$BUN_BIN" run "$BOT_SCRIPT" >> "$LOG_FILE" 2>&1 &
echo "[$(date)] Bot launched in background." >> "$LOG_FILE"
