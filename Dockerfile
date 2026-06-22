FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

# ── Install dependencies ───────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json       apps/api/package.json
COPY apps/collector/package.json apps/collector/package.json
COPY apps/web/package.json       apps/web/package.json
COPY packages/db/package.json          packages/db/package.json
COPY packages/rivian-api/package.json  packages/rivian-api/package.json
COPY packages/shared/package.json      packages/shared/package.json
RUN pnpm install --frozen-lockfile

# ── Build everything ───────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm build

# ── Lean runtime image ─────────────────────────────────────────────────────────
FROM base AS runtime

ENV NODE_ENV=production \
    APP_PORT=4000 \
    WEB_DIST_DIR=/app/apps/web/dist

COPY --from=build /app /app
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 4000

ENTRYPOINT ["/docker-entrypoint.sh"]
