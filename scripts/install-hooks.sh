#!/bin/bash
# install-hooks.sh — installs local git hooks for this repo.
# Run this once after a fresh clone:  bash scripts/install-hooks.sh

REPO_DIR="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_DIR/.git/hooks"

echo "🔗 Installing git hooks..."

# Remove old post-push if exists
rm -f "$HOOKS_DIR/post-push"

cat > "$HOOKS_DIR/pre-push" << 'EOF'
#!/bin/bash
# pre-push git hook — automatically deploy after every successful push.
# Output is logged to /tmp/agentic-media-bot-deploy.log so it never blocks the terminal.

REPO_DIR="$(git rev-parse --show-toplevel)"
DEPLOY_SCRIPT="$REPO_DIR/scripts/deploy-to-media-stack.sh"
LOG_FILE="/tmp/agentic-media-bot-deploy.log"

echo ""
echo "🚀 Running pre-push deploy..."

# Run deploy in the background so the terminal is freed immediately.
# Stdout + stderr are captured in the log file.
(
    echo "--- Deploy triggered at $(date) ---" >> "$LOG_FILE"
    bash "$DEPLOY_SCRIPT" >> "$LOG_FILE" 2>&1
    EXIT_CODE=$?

    if [ $EXIT_CODE -eq 0 ]; then
        echo "✅ Deploy + service restart completed at $(date)" >> "$LOG_FILE"
    else
        echo "❌ Deploy script failed (exit $EXIT_CODE) at $(date)" >> "$LOG_FILE"
    fi
) &

echo "   Deploy is running in the background."
echo "   Follow progress with: tail -f $LOG_FILE"
echo ""

exit 0
EOF

chmod +x "$HOOKS_DIR/pre-push"
echo "✅ pre-push hook installed."
echo ""
echo "The hook will automatically build and deploy to media-stack after every 'git push'."
echo "Deploy log: /tmp/agentic-media-bot-deploy.log"
