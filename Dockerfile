ARG NODE_VERSION=26.1.0
FROM node:${NODE_VERSION}-bookworm-slim AS build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY index.html tsconfig.json vite.config.ts ./
COPY migrations ./migrations
COPY src ./src
RUN pnpm run build:production

ARG NODE_VERSION=26.1.0
FROM node:${NODE_VERSION}-bookworm-slim

ENV NODE_ENV=production
ENV PORT=3000
ENV GAMES_DB_PATH=/app/data/games.sqlite
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/migrations ./migrations

EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "dist-server/index.js"]
