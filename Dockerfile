ARG BUN_VERSION=1.3.13
FROM dhi.io/bun:${BUN_VERSION}-dev@sha256:30d0bce716714f45ea67d6ef96d5eb7d4d43352c6b131f27bfff978eb5872076 AS build

WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun ci

COPY index.html tsconfig.json ./
COPY migrations ./migrations
COPY src ./src
RUN bun run build:production

ARG BUN_VERSION=1.3.13
FROM dhi.io/bun:${BUN_VERSION}@sha256:cdb41f48da771a6db2c5a4a8b6b4722876422865577770865eb5f549177cd8c6

ENV NODE_ENV=production
ENV PORT=3000
ENV GAMES_DB_PATH=/app/data/games.sqlite
WORKDIR /app/dist
COPY --from=build /app/dist ./

EXPOSE 3000
VOLUME ["/app/data"]
CMD ["bun", "run", "server.js"]
