import type { Config } from "./config.js";
import type { TokenCrypto } from "./crypto.js";
import type { Db } from "./db/client.js";
import type { RivianApi } from "./rivian/client.js";
import type { RivianGovernor } from "./rivian/governor.js";
import type { RivianTokens } from "./rivian/types.js";
import type { LiveBus } from "./services/live-bus.js";
import type { NotificationService } from "./services/notifications.js";
import type { TokenStore } from "./services/token-store.js";
import type {
  RivianConnection,
  VehicleMonitor,
} from "./services/vehicle-monitor.js";

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
  db: Db;
  crypto: TokenCrypto;
  tokenStore: TokenStore;
  bus: LiveBus;
  monitor: VehicleMonitor;
  notifications: NotificationService;
  rivianFactory: RivianFactory;
  /** Shared throttle/cooldown/counters for all Rivian traffic. */
  governor: RivianGovernor;
  /** In-flight login awaiting OTP; single-user so one slot is enough. */
  pendingConnect: PendingConnect | null;
}
