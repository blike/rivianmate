# RivianMate

RivianMate is a self-hosted Rivian vehicle logger inspired by TeslaMate, implemented in TypeScript with PostgreSQL and first-party in-app dashboards instead of Grafana.

See [docs/rivianmate-plan.md](docs/rivianmate-plan.md), [docs/product-spec.md](docs/product-spec.md), and [docs/development-roadmap.md](docs/development-roadmap.md) for the product, technical, and implementation plan.

## Development

```bash
pnpm install
cp .env.example .env
pnpm dev
```

The React app runs on `http://localhost:5173` in development and the Fastify API runs on `http://localhost:4000`.

## Docker Compose

```bash
cp .env.example .env
docker compose up -d
```

The production app is exposed on `http://localhost:4000`.
