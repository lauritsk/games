ARG BUN_VERSION=1.3.13
FROM dhi.io/bun:${BUN_VERSION}-dev AS build

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY index.html tsconfig.json ./
COPY src ./src
RUN bun build ./src/server.ts --outdir ./dist --target bun

ARG BUN_VERSION=1.3.13
FROM dhi.io/bun:${BUN_VERSION}

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app/dist
COPY --from=build /app/dist ./
COPY --from=build /app/index.html /app/index.html

EXPOSE 3000
CMD ["bun", "run", "server.js"]
