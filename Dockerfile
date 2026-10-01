# Compile portable JavaScript/assets once, without emulating the target CPU.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY server ./server
COPY web ./web
RUN pnpm -r build

# Keep runtime dependencies target-specific, including any native modules.
# Source edits must not invalidate installation or production packaging.
FROM node:22-alpine AS runtime-deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm --filter @rivianmate/server... install --prod --frozen-lockfile
RUN pnpm --filter @rivianmate/server deploy --prod --legacy /prod/server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY --from=runtime-deps /prod/server/node_modules ./node_modules
COPY --from=runtime-deps /prod/server/package.json ./package.json
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/drizzle ./drizzle
COPY --from=build /app/web/dist ./web-dist
EXPOSE 4000
# 127.0.0.1, not localhost: in Alpine "localhost" may resolve to ::1 first,
# but the server listens on IPv4 only.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO /dev/null http://127.0.0.1:${PORT}/api/status || exit 1
CMD ["node", "dist/index.js"]
