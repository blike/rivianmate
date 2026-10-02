import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { AppContext, RivianFactory } from "./context.js";
import { TokenCrypto, hashPassword } from "./crypto.js";
import { createDb, runMigrations } from "./db/client.js";
import { appSettings } from "./db/schema.js";
import { passwordProblem } from "./password-policy.js";
import { RivianClient, type RivianApi } from "./rivian/client.js";
import { RivianGovernor } from "./rivian/governor.js";
import { MockRivian, mockGeocode } from "./rivian/mock.js";
import { RivianSubscriptionManager } from "./rivian/subscription.js";
import { getPasswordHash } from "./routes/auth.js";
import { DrivePlaces, nominatimGeocoder } from "./services/drive-places.js";
import { LiveBus } from "./services/live-bus.js";
import { TokenStore } from "./services/token-store.js";
import { VehicleMonitor } from "./services/vehicle-monitor.js";
import { loadVersion } from "./version.js";

const START_RETRY_BASE_MS = 30_000;
const START_RETRY_MAX_MS = 15 * 60_000;

const here = dirname(fileURLToPath(import.meta.url));

function resolveWebDist(): string | undefined {
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

  const governor = new RivianGovernor();
  const rivianFactory: RivianFactory = config.MOCK_RIVIAN
    ? mockFactory()
    : realFactory(governor);

  const monitor = new VehicleMonitor(
    db,
    tokenStore,
    bus,
    (tokens) => rivianFactory.createConnection(tokens),
    (msg) => console.log(`[monitor] ${msg}`),
    config.REVERSE_GEOCODING
      ? new DrivePlaces(
          db,
          // Mock drives are in made-up places; don't look them up.
          config.MOCK_RIVIAN
            ? mockGeocode
            : nominatimGeocoder(
                `RivianMate/${loadVersion().version ?? "dev"} (self-hosted; https://github.com/blike/rivianmate)`,
              ),
          (msg) => console.log(`[places] ${msg}`),
        )
      : undefined,
  );

  const ctx: AppContext = {
    config: {
      ...config,
      WEB_DIST: resolveWebDist(),
    },
    db,
    crypto,
    tokenStore,
    bus,
    monitor,
    rivianFactory,
    governor,
    pendingConnect: null,
  };

  // Optional: seed the app password from the environment on first boot.
  if (config.APP_PASSWORD && (await getPasswordHash(ctx)) === null) {
    const problem = passwordProblem(config.APP_PASSWORD);
    if (problem) throw new Error(`APP_PASSWORD is too weak: ${problem}`);
    await db
      .insert(appSettings)
      .values({
        key: "app_password_hash",
        value: hashPassword(config.APP_PASSWORD),
      })
      .onConflictDoNothing();
  }

  const app = await buildApp(ctx);

  if (config.MOCK_RIVIAN) console.log("MOCK_RIVIAN enabled (OTP is 000000)");

  // Listen first: the API and healthcheck must not wait on Rivian.
  await app.listen({ port: config.PORT, host: "0.0.0.0" });

  // A network blip at boot (e.g. container networking not up yet) must not
  // leave tracking off until the next restart: retry with backoff.
  let startRetry: NodeJS.Timeout | undefined;
  const startMonitor = (attempt = 0): void => {
    void monitor
      .startIfConfigured()
      .then((result) => {
        if (result === "started") {
          console.log("Rivian monitor started from stored credentials");
        } else if (result === "needs_login") {
          console.log("Rivian session expired; sign in again from the web UI");
        } else {
          console.log(
            "No usable Rivian account stored (not connected yet, or APP_SECRET changed); connect from the web UI",
          );
        }
      })
      .catch((err) => {
        if (monitor.isRunning) return; // connected meanwhile (e.g. from the web UI)
        const delay = Math.min(START_RETRY_MAX_MS, START_RETRY_BASE_MS * 2 ** attempt);
        console.error(
          `Failed to start Rivian monitor: ${(err as Error).message}; retrying in ${Math.round(delay / 1000)}s`,
        );
        startRetry = setTimeout(() => startMonitor(attempt + 1), delay);
      });
  };
  startMonitor();

  const shutdown = async () => {
    clearTimeout(startRetry);
    await monitor.stop();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

function realFactory(governor: RivianGovernor): RivianFactory {
  return {
    createApi: (tokens) => new RivianClient({ tokens, governor }),
    createConnection: (tokens, existing?: RivianApi) => {
      const api = existing ?? new RivianClient({ tokens, governor });
      const stream = new RivianSubscriptionManager({
        getCredentials: () => ({
          userSessionToken: api.userSessionToken,
          appSession: api.appSession,
        }),
        governor,
        log: (msg) => console.log(`[ws] ${msg}`),
      });
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
