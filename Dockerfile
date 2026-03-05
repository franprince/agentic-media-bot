FROM oven/bun:1 as base
WORKDIR /usr/src/app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Run the app 
CMD ["bun", "run", "src/bot.ts"]
