import type { Config } from './config.js';
import type { TokenCrypto } from './crypto.js';
import type { Db } from './db/client.js';
import type { LogBuffer } from './log-buffer.js';
import type { Logger } from './logger.js';
import type { RivianApi } from './rivian/client.js';
import type { RivianGovernor } from './rivian/governor.js';
import type { RivianTokens } from './rivian/types.js';
import type { PlaceSearch } from './services/drive-places.js';
import type { LiveBus } from './services/live-bus.js';
import type { LoginThrottle } from './services/login-throttle.js';
import type { NotificationService } from './services/notifications.js';
import type { TokenStore } from './services/token-store.js';
import type { TeslaMateSource } from './teslamate/source.js';
import type { RivianConnection, VehicleMonitor } from './services/vehicle-monitor.js';

export interface RivianFactory {
  createApi(tokens?: RivianTokens): RivianApi;
  /**
   * Builds the long-lived API + stream pair. Pass the API that just logged in
   * to reuse its CSRF/app session instead of creating another one.
   */
  createConnection(tokens: RivianTokens, api?: RivianApi): RivianConnection;
}

export interface PendingConnect {
  api: RivianApi;
  email: string;
}

export interface AppContext {
  config: Config;
  log: Logger;
  /** Recent log lines, for Settings → Logs. */
  logs: LogBuffer;
  db: Db;
  crypto: TokenCrypto;
  /** Limits password guesses. */
  loginThrottle: LoginThrottle;
  tokenStore: TokenStore;
  bus: LiveBus;
  monitor: VehicleMonitor;
  notifications: NotificationService;
  rivianFactory: RivianFactory;
  /** Vehicles read from a TeslaMate database, when one is set up. */
  teslamate: TeslaMateSource;
  /** Shared throttle/cooldown/counters for all Rivian traffic. */
  governor: RivianGovernor;
  /** Address search for placing saved locations. */
  searchPlaces: PlaceSearch;
  /** In-flight login awaiting OTP; single-user so one slot is enough. */
  pendingConnect: PendingConnect | null;
}
