import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { AppContext, RivianFactory } from './context.js';
import { TokenCrypto, hashPassword } from './crypto.js';
import { createDb, runMigrations } from './db/client.js';
import { appSettings } from './db/schema.js';
import { LogBuffer } from './log-buffer.js';
import { type Logger, createLogger } from './logger.js';
import { passwordProblem } from './password-policy.js';
import { RivianClient, type RivianApi } from './rivian/client.js';
import { RivianGovernor } from './rivian/governor.js';
import { type MockScene, MockRivian, mockGeocode } from './rivian/mock.js';
import { RivianSubscriptionManager } from './rivian/subscription.js';
import { getPasswordHash } from './routes/auth.js';
import { DrivePlaces, nominatimGeocoder, nominatimSearch } from './services/drive-places.js';
import { LiveBus } from './services/live-bus.js';
import { NotificationService } from './services/notifications.js';
import { TokenStore } from './services/token-store.js';
import { VehicleMonitor } from './services/vehicle-monitor.js';
import { HistoryKeys } from './services/history-keys.js';
import { HistoryMaintenance } from './services/history-maintenance.js';
import { ParallaxArchive } from './services/parallax-archive.js';
import { loadVersion } from './version.js';

const START_RETRY_BASE_MS = 30_000;
const START_RETRY_MAX_MS = 15 * 60_000;

const here = dirname(fileURLToPath(import.meta.url));

function resolveWebDist(): string | undefined {
  const candidates = [join(here, '..', 'web-dist'), join(here, '..', '..', 'web', 'dist')];
  return candidates.find((candidate) => existsSync(candidate));
}

let log: Logger | undefined;

async function main(): Promise<void> {
  const config = loadConfig();
  const logs = new LogBuffer();
  const logger = createLogger(config, process.stdout, logs);
  const appLog = logger.child({ component: 'app' });
  log = appLog;

  const migrationsFolder = join(here, '..', 'drizzle');
  await runMigrations(config.DATABASE_URL, migrationsFolder);

  const { db } = createDb(config.DATABASE_URL);
  const historyLog = logger.child({ component: 'history' });
  const historyKeys = new HistoryKeys(db);
  const history = new HistoryMaintenance(
    db,
    historyKeys,
    new ParallaxArchive(db, historyKeys, historyLog),
    historyLog,
  );
  history.start();
  const crypto = new TokenCrypto(config.APP_SECRET);
  const tokenStore = new TokenStore(db, crypto, logger.child({ component: 'monitor' }));
  const bus = new LiveBus();

  const governor = new RivianGovernor();
  const rivianFactory: RivianFactory = config.MOCK_RIVIAN
    ? mockFactory(config.MOCK_SCENE)
    : realFactory(governor, logger);

  const userAgent = `RivianMate/${loadVersion().version ?? 'dev'} (self-hosted; https://github.com/blike/rivianmate)`;
  const monitor = new VehicleMonitor(
    db,
    tokenStore,
    bus,
    (tokens) => rivianFactory.createConnection(tokens),
    logger,
    new DrivePlaces(
      db,
      // Mock drives are in made-up places; don't look them up.
      config.MOCK_RIVIAN ? mockGeocode : nominatimGeocoder(userAgent),
      logger.child({ component: 'places' }),
    ),
  );

  const notifications = new NotificationService(
    db,
    crypto,
    () => monitor.getVehicles(),
    (vehicleId) => monitor.getState(vehicleId),
    logger.child({ component: 'notify' }),
  );
  notifications.start(bus);

  const ctx: AppContext = {
    config: {
      ...config,
      WEB_DIST: resolveWebDist(),
    },
    log: logger,
    logs,
    db,
    crypto,
    tokenStore,
    bus,
    monitor,
    notifications,
    rivianFactory,
    governor,
    // Searches are typed by the user, so they run in mock mode too.
    searchPlaces: nominatimSearch(userAgent),
    pendingConnect: null,
  };

  // Optional: seed the app password from the environment on first boot.
  if (config.APP_PASSWORD && (await getPasswordHash(ctx)) === null) {
    const problem = passwordProblem(config.APP_PASSWORD);
    if (problem) throw new Error(`APP_PASSWORD is too weak: ${problem}`);
    await db
      .insert(appSettings)
      .values({
        key: 'app_password_hash',
        value: hashPassword(config.APP_PASSWORD),
      })
      .onConflictDoNothing();
  }

  const app = await buildApp(ctx);

  if (config.MOCK_RIVIAN) appLog.warn('MOCK_RIVIAN enabled (OTP is 000000)');

  // Listen first: the API and healthcheck must not wait on Rivian.
  // Fastify logs a line per network interface (loopback, Docker network...),
  // none of which is the address you'd browse to; one line is enough.
  const httpLevel = app.log.level;
  app.log.level = 'warn';
  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } finally {
    app.log.level = httpLevel;
  }
  appLog.info(`listening on port ${config.PORT}`);

  // A network blip at boot (e.g. container networking not up yet) must not
  // leave tracking off until the next restart: retry with backoff.
  let startRetry: NodeJS.Timeout | undefined;
  const startMonitor = (attempt = 0): void => {
    void monitor
      .startIfConfigured()
      .then((result) => {
        if (result === 'started') {
          appLog.info('Rivian monitor started from stored credentials');
        } else if (result === 'needs_login') {
          appLog.warn('Rivian session expired; sign in again from the web UI');
        } else {
          appLog.warn(
            'No usable Rivian account stored (not connected yet, or APP_SECRET changed); connect from the web UI',
          );
        }
      })
      .catch((err) => {
        if (monitor.isRunning) return; // connected meanwhile (e.g. from the web UI)
        const delay = Math.min(START_RETRY_MAX_MS, START_RETRY_BASE_MS * 2 ** attempt);
        appLog.error(
          { err },
          `failed to start Rivian monitor; retrying in ${Math.round(delay / 1000)}s`,
        );
        startRetry = setTimeout(() => startMonitor(attempt + 1), delay);
      });
  };
  startMonitor();

  const shutdown = async () => {
    appLog.info('shutting down');
    clearTimeout(startRetry);
    notifications.stop();
    history.stop();
    await monitor.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

function realFactory(governor: RivianGovernor, logger: Logger): RivianFactory {
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
        log: logger.child({ component: 'ws' }),
      });
      return { api, stream };
    },
  };
}

/** The mock is a single object acting as both API and state stream. */
function mockFactory(scene?: MockScene): RivianFactory {
  const mock = new MockRivian({ scene });
  return {
    createApi: () => mock,
    createConnection: () => ({ api: mock, stream: mock }),
  };
}

main().catch((err: unknown) => {
  // The logger doesn't exist yet if the environment itself is invalid.
  if (log) log.fatal({ err }, 'startup failed');
  else console.error(err);
  process.exit(1);
});
