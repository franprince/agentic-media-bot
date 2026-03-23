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

# Ensure current bot process is stopping.
echo "Restarting bot: Killing old PID $OLD_PID" >> "$LOG_FILE"
kill "$OLD_PID" 2>/dev/null || true

# Wait up to 10 seconds for shutdown.
ATTEMPTS=100
while kill -0 "$OLD_PID" 2>/dev/null; do
  ATTEMPTS=$((ATTEMPTS - 1))
  if [ "$ATTEMPTS" -le 0 ]; then
    echo "Stale process $OLD_PID still alive after 10s. Force killing..." >> "$LOG_FILE"
    kill -9 "$OLD_PID" 2>/dev/null || true
    break
  fi
  sleep 0.1
done

nohup "$BUN_BIN" run "$BOT_SCRIPT" >> "$LOG_FILE" 2>&1 &
