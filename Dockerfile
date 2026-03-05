FROM oven/bun:latest as base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Deployment env
ENV NODE_ENV=production

# The bot uses port 3000 for webhooks
EXPOSE 3000

# Run the bot
CMD ["bun", "run", "src/bot.ts"]
