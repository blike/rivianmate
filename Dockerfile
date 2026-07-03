FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY eslint.config.mjs ./
COPY server ./server
COPY web ./web
RUN pnpm -r build
RUN pnpm --filter @rivianmate/server deploy --prod --legacy /prod/server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY --from=build /prod/server/node_modules ./node_modules
COPY --from=build /prod/server/package.json ./package.json
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/drizzle ./drizzle
COPY --from=build /app/web/dist ./web-dist
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://localhost:4000/api/status || exit 1
CMD ["node", "dist/index.js"]
