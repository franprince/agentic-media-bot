#!/usr/bin/env bash
#
# install-nzbget-extension.sh — copies the AgenticMediaBot extension into
# NZBGet's ScriptDir.
#
# Copy only. This never edits nzbget.conf and never restarts the container:
# enabling the extension is a deliberate manual step in NZBGet's Settings, and
# nzbget.conf is runtime state that does not belong to this repo.
#
# Usage:
#   bash scripts/install-nzbget-extension.sh [SCRIPT_DIR]
#
# SCRIPT_DIR defaults to the host path backing the container's /config/scripts.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$REPO_DIR/extensions/nzbget/AgenticMediaBot"
SCRIPT_DIR="${1:-/home/fran/Documentos/media-stack/nzbget/config/scripts}"
TARGET_DIR="$SCRIPT_DIR/AgenticMediaBot"

if [ ! -d "$SOURCE_DIR" ]; then
	echo "❌ Extension source not found: $SOURCE_DIR" >&2
	exit 1
fi

if [ ! -d "$SCRIPT_DIR" ]; then
	echo "❌ NZBGet ScriptDir not found: $SCRIPT_DIR" >&2
	echo "   Pass the correct path as the first argument." >&2
	exit 1
fi

echo "📦 Installing AgenticMediaBot extension"
echo "   from: $SOURCE_DIR"
echo "   to:   $TARGET_DIR"

mkdir -p "$TARGET_DIR"
cp "$SOURCE_DIR/manifest.json" "$TARGET_DIR/manifest.json"
cp "$SOURCE_DIR/main.sh" "$TARGET_DIR/main.sh"
chmod +x "$TARGET_DIR/main.sh"

echo "✅ Files installed."
echo
echo "Remaining manual steps (NZBGet only runs extensions that are enabled):"
echo "  1. Open NZBGet → Settings, and reload the page so the new extension is detected."
echo "  2. Add 'AgenticMediaBot' to Settings → EXTENSION SCRIPTS → Extensions"
echo "     (or to a category's Extensions to scope it)."
echo "  3. Confirm WebhookUrl points at the bot proxy (default http://localhost:3001/nzbget-webhook)."
echo "  4. Save and reload NZBGet."
