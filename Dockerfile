FROM oven/bun:latest AS base
WORKDIR /app

# Install dependencies.
# --omit=optional skips `chowa`, a local-only tooling dependency resolved from
# `file:../chōwa`. That sibling checkout exists only on the maintainer's machine,
# so without this the build fails here with:
#   ENOENT: failed opening cache/package/version dir for package chowa
# The CI workflow omits it for the same reason.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --omit=optional

# Copy source
COPY . .

# Deployment env
ENV NODE_ENV=production

# Install curl for healthcheck
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# The bot uses port 3000 for webhooks and healthcheck
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Run the bot
CMD ["bun", "run", "src/bot.ts"]
