FROM dhi.io/node:26-alpine3.23-dev@sha256:88d721c72f82cc1522b4900750bdc7cc7191e73d5b9b5343d8e970ef4a3cf5d1 AS build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
RUN pnpm exec vp run build:production

FROM dhi.io/node:26-alpine3.23@sha256:e13734fabe5fe8bc2a139a7cb6fdddb07a18806ef5766af4dd91043ccf75bfc8

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

EXPOSE 3000
CMD ["node", "dist-server/index.js"]
