ARG BUN_VERSION=1.3.13
FROM dhi.io/bun:${BUN_VERSION}-dev AS build

WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun ci

COPY index.html tsconfig.json ./
COPY migrations ./migrations
COPY src ./src
RUN bun run build:production

ARG BUN_VERSION=1.3.13
FROM dhi.io/bun:${BUN_VERSION}

ENV NODE_ENV=production
ENV PORT=3000
ENV GAMES_DB_PATH=/app/data/games.sqlite
WORKDIR /app/dist
COPY --from=build /app/dist ./

EXPOSE 3000
VOLUME ["/app/data"]
CMD ["bun", "run", "server.js"]
