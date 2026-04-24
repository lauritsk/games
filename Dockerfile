FROM dhi.io/bun:1-dev AS build

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY index.html tsconfig.json ./
COPY src ./src
RUN bun build ./src/server.ts --outdir ./dist --target bun

FROM dhi.io/bun:1

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app/dist
COPY --from=build /app/dist ./

EXPOSE 3000
CMD ["bun", "run", "server.js"]
