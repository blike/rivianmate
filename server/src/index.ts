import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { AppContext, RivianFactory } from "./context.js";
import { TokenCrypto, hashPassword } from "./crypto.js";
import { createDb, runMigrations } from "./db/client.js";
import { appSettings } from "./db/schema.js";
import { RivianClient } from "./rivian/client.js";
import { MockRivian } from "./rivian/mock.js";
import { RivianSubscriptionManager } from "./rivian/subscription.js";
import { LiveBus } from "./services/live-bus.js";
import { TokenStore } from "./services/token-store.js";
import { VehicleMonitor } from "./services/vehicle-monitor.js";

const here = dirname(fileURLToPath(import.meta.url));

function resolveWebDist(configuredPath?: string): string | undefined {
  if (configuredPath) return configuredPath;

  const candidates = [
    join(here, "..", "web-dist"),
    join(here, "..", "..", "web", "dist"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

async function main(): Promise<void> {
  const config = loadConfig();

  const migrationsFolder = join(here, "..", "drizzle");
  await runMigrations(config.DATABASE_URL, migrationsFolder);

  const { db } = createDb(config.DATABASE_URL);
  const crypto = new TokenCrypto(config.APP_SECRET);
  const tokenStore = new TokenStore(db, crypto);
  const bus = new LiveBus();

  const rivianFactory: RivianFactory = config.MOCK_RIVIAN
    ? mockFactory()
    : realFactory();

  const monitor = new VehicleMonitor(
    db,
    tokenStore,
    bus,
    (tokens) => rivianFactory.createConnection(tokens),
    (msg) => console.log(`[monitor] ${msg}`),
  );

  const ctx: AppContext = {
    config: {
      ...config,
      WEB_DIST: resolveWebDist(config.WEB_DIST),
    },
    db,
    crypto,
    tokenStore,
    bus,
    monitor,
    rivianFactory,
    pendingConnect: null,
  };

  // Optional: seed the app password from the environment on first boot.
  if (config.APP_PASSWORD) {
    await db
      .insert(appSettings)
      .values({
        key: "app_password_hash",
        value: hashPassword(config.APP_PASSWORD),
      })
      .onConflictDoNothing();
  }

  const app = await buildApp(ctx);

  const started = await monitor.startIfConfigured().catch((err) => {
    console.error(`Failed to start Rivian monitor: ${(err as Error).message}`);
    return false;
  });
  if (started) console.log("Rivian monitor started from stored credentials");
  if (config.MOCK_RIVIAN) console.log("MOCK_RIVIAN enabled (OTP is 000000)");

  await app.listen({ port: config.PORT, host: config.HOST });

  const shutdown = async () => {
    await monitor.stop();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

function realFactory(): RivianFactory {
  return {
    createApi: (tokens) => new RivianClient({ tokens }),
    createConnection: (tokens) => {
      const api = new RivianClient({ tokens });
      const stream = new RivianSubscriptionManager(
        () => api.userSessionToken,
        undefined,
        (msg) => console.log(`[ws] ${msg}`),
      );
      return { api, stream };
    },
  };
}

/** The mock is a single object acting as both API and state stream. */
function mockFactory(): RivianFactory {
  const mock = new MockRivian();
  return {
    createApi: () => mock,
    createConnection: () => ({ api: mock, stream: mock }),
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
