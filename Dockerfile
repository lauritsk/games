FROM dhi.io/node:25-alpine3.22-dev@sha256:cecc0d6394e711d73df0cfa7cd6ce6ec2ffcca070a0999bf98a597b34a7b8890 AS build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
RUN pnpm exec vp run build:production

FROM dhi.io/node:25-alpine3.22@sha256:99851bac3e2268b16e67f6a429b08ea7ce128288353a06487ee9a13131c2e709

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

EXPOSE 3000
CMD ["node", "dist-server/index.js"]
