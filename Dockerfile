ARG BUN_VERSION=1.3.13
FROM dhi.io/bun:${BUN_VERSION}-dev AS build

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY index.html tsconfig.json ./
COPY src ./src
RUN bun build ./index.html --outdir ./dist/public --minify \
    && bun build ./src/ui/service-worker.js --outdir ./dist/public --minify --entry-naming='[name].[ext]' \
    && cp src/ui/favicon.svg ./dist/public/favicon.svg \
    && bun build ./src/server/index.ts --outdir ./dist --target bun --root . --entry-naming='server.[ext]'

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
