import type { Config } from "./config.js";
import type { TokenCrypto } from "./crypto.js";
import type { Db } from "./db/client.js";
import type { RivianApi } from "./rivian/client.js";
import type { RivianTokens } from "./rivian/types.js";
import type { LiveBus } from "./services/live-bus.js";
import type { TokenStore } from "./services/token-store.js";
import type {
  RivianConnection,
  VehicleMonitor,
} from "./services/vehicle-monitor.js";

export interface RivianFactory {
  createApi(tokens?: RivianTokens): RivianApi;
  createConnection(tokens: RivianTokens): RivianConnection;
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
  rivianFactory: RivianFactory;
  /** In-flight login awaiting OTP; single-user so one slot is enough. */
  pendingConnect: PendingConnect | null;
}
