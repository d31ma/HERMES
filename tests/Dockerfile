FROM oven/bun:1.3.11

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install

COPY tests/ ./tests/
COPY server/ ./server/
COPY scripts/ ./scripts/
COPY jsconfig.json ./
COPY tachyon-env.d.ts ./

ENV NODE_ENV=test

CMD ["bun", "test", "tests/integration/", "--timeout", "60000"]
