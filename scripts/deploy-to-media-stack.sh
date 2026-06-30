#!/bin/bash
set -e

REPO_DIR="/home/fran/Documentos/repos/agentic-media-bot"
TARGET_DIR="/home/fran/Documentos/media-stack/bot"

echo "🧹 Creating target directory: $TARGET_DIR..."
mkdir -p "$TARGET_DIR"
mkdir -p "$TARGET_DIR/proxy-ui"

echo "📦 Building proxy UI..."
cd "$REPO_DIR/proxy-ui"
bun run build

echo "⚡ Bundling Bot and Proxy via Bun..."
cd "$REPO_DIR"
bun build src/bot.ts --target bun --outfile dist/bot.js
bun build src/proxy.ts --target bun --outfile dist/proxy.js

echo "🚚 Copying bundled files to target..."
cp dist/bot.js "$TARGET_DIR/bot.js"
cp dist/proxy.js "$TARGET_DIR/proxy.js"
if [ -f "CHANGELOG.md" ]; then
    cp "CHANGELOG.md" "$TARGET_DIR/CHANGELOG.md"
fi

echo "🔑 Copying environment file..."
if [ -f "$REPO_DIR/.env.local" ]; then
    if [ ! -f "$TARGET_DIR/.env.local" ]; then
        cp "$REPO_DIR/.env.local" "$TARGET_DIR/.env.local"
    else
        echo "⚠️  .env.local already exists in target, keeping existing config."
    fi
else
    echo "❌ Error: .env.local not found in repository."
    exit 1
fi

echo "🖼️  Copying static assets..."
rm -rf "$TARGET_DIR/proxy-ui/dist"
cp -r "$REPO_DIR/proxy-ui/dist" "$TARGET_DIR/proxy-ui/dist"

echo "✅ Build and deployment complete!"
