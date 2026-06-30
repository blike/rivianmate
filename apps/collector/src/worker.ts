import "dotenv/config";

import {
  createDatabase,
  dataQualityEvents,
  persistChargingData,
  persistVehicleStateEvent,
  rivianCredentials,
  stableStringify,
  vehicles
} from "@rivianmate/db";
import { RivianApiClient, type RivianTokens, type VehicleStateSubscription } from "@rivianmate/rivian-api";
import { and, eq, lt } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";

import { decryptText } from "./encryption.js";

const config = z
  .object({
    APP_SECRET: z.string().min(32),
    CHARGING_LIVE_FETCH_ENABLED: z.coerce.boolean().default(false),
    CHARGING_PLUGGED_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
    CHARGING_UNPLUGGED_INTERVAL_SECONDS: z.coerce.number().int().positive().default(900),
    COLLECTOR_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
    DATABASE_URL: z
      .string()
      .url()
      .default("postgres://rivianmate:rivianmate@localhost:5432/rivianmate"),
    RIVIAN_LIVE_WEBSOCKET_ENABLED: z.coerce.boolean().default(false)
  })
  .parse(process.env);

const database = createDatabase(config.DATABASE_URL);
const rivianApi = new RivianApiClient();

// Per-vehicle state
const chargingBackoffByVehicleId = new Map<string, number>();
const chargingLiveUnsupportedVehicleIds = new Set<string>();
const nextChargingFetchByVehicleId = new Map<string, number>();
const subscriptions = new Map<string, VehicleStateSubscription>();
const subscriptionClosedVehicleIds = new Set<string>(); // vehicles whose sub closed unexpectedly
const lastEventReceivedByVehicleId = new Map<string, Date>();
const eventsThisTickByVehicleId = new Map<string, number>();

let interval: NodeJS.Timeout | undefined;
let shuttingDown = false;

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  await database.client`select 1`;
  console.log("RivianMate collector started.");
  await tick();
  interval = setInterval(() => {
    void tick().catch((error) => {
      console.error("Collector tick failed.", error);
    });
  }, config.COLLECTOR_INTERVAL_SECONDS * 1000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (interval) clearInterval(interval);
  await Promise.allSettled([...subscriptions.values()].map((s) => s.unsubscribe()));
  console.log("Stopping RivianMate collector.");
  await database.client.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("Collector failed to start.", error);
  await database.client.end();
  process.exit(1);
});

// ─── Tick ─────────────────────────────────────────────────────────────────────

async function tick() {
  const enabledVehicles = await database.db
    .select({ accountId: vehicles.accountId, id: vehicles.id, name: vehicles.name, rivianVehicleId: vehicles.rivianVehicleId })
    .from(vehicles)
    .where(eq(vehicles.enabled, true));

  const credentialRows = await database.db.select().from(rivianCredentials);
  const credentialsByAccountId = new Map(
    credentialRows
      .map((credential) => {
        if (!credential.encryptedAccessToken || !credential.encryptedRefreshToken || !credential.encryptedUserSessionToken) return null;
        return [
          credential.accountId,
          {
            accessToken: decryptText(credential.encryptedAccessToken, config.APP_SECRET),
            refreshToken: decryptText(credential.encryptedRefreshToken, config.APP_SECRET),
            userSessionToken: decryptText(credential.encryptedUserSessionToken, config.APP_SECRET)
          } satisfies RivianTokens
        ] as const;
      })
      .filter((entry): entry is readonly [string, RivianTokens] => Boolean(entry))
  );

  const collectableVehicles = enabledVehicles.filter((v) => credentialsByAccountId.has(v.accountId));

  if (collectableVehicles.length === 0) {
    await database.db.insert(dataQualityEvents).values({
      category: "collector_heartbeat",
      message: enabledVehicles.length === 0 ? "no_enabled_vehicles" : "missing_rivian_credentials",
      raw: { enabledVehicles: enabledVehicles.length },
      severity: "info"
    });
    console.log("Collector heartbeat: no collectable vehicles yet.");
    await pruneOldHeartbeats();
    return;
  }

  for (const vehicle of collectableVehicles) {
    const tokens = credentialsByAccountId.get(vehicle.accountId)!;

    if (config.RIVIAN_LIVE_WEBSOCKET_ENABLED && (!subscriptions.has(vehicle.id) || subscriptionClosedVehicleIds.has(vehicle.id))) {
      if (subscriptionClosedVehicleIds.has(vehicle.id)) {
        subscriptionClosedVehicleIds.delete(vehicle.id);
        subscriptions.delete(vehicle.id);
        await database.db.insert(dataQualityEvents).values({
          category: "vehicle_subscription",
          message: "reconnecting",
          raw: { vehicleName: vehicle.name },
          severity: "warning",
          vehicleId: vehicle.id
        });
        console.warn(`Re-subscribing to ${vehicle.name} after unexpected close.`);
      }
      await openSubscription(vehicle, tokens);
    }

    if (config.CHARGING_LIVE_FETCH_ENABLED) {
      await fetchChargingIfDue(vehicle, tokens);
    }

    const eventsThisTick = eventsThisTickByVehicleId.get(vehicle.id) ?? 0;
    eventsThisTickByVehicleId.set(vehicle.id, 0);
    const lastEventAt = lastEventReceivedByVehicleId.get(vehicle.id) ?? null;
    const minutesSinceLastEvent = lastEventAt != null
      ? Math.round((Date.now() - lastEventAt.getTime()) / 60000)
      : null;

    await database.db.insert(dataQualityEvents).values({
      category: "collector_heartbeat",
      message: "collector_ready",
      raw: {
        eventsThisTick,
        liveChargingFetchEnabled: config.CHARGING_LIVE_FETCH_ENABLED,
        liveWebSocketEnabled: config.RIVIAN_LIVE_WEBSOCKET_ENABLED,
        lastEventAt: lastEventAt?.toISOString() ?? null,
        minutesSinceLastEvent,
        vehicleName: vehicle.name
      },
      severity: "info",
      vehicleId: vehicle.id
    });

    if (subscriptions.has(vehicle.id) && minutesSinceLastEvent != null && minutesSinceLastEvent >= 10) {
      await database.db.insert(dataQualityEvents).values({
        category: "vehicle_subscription",
        message: "stale_subscription",
        raw: { minutesSinceLastEvent, vehicleName: vehicle.name },
        severity: "warning",
        vehicleId: vehicle.id
      });
      console.warn(`[${vehicle.name}] No events received in ${minutesSinceLastEvent} minutes — subscription may be stale.`);
    }
  }

  console.log(`Collector heartbeat: ${collectableVehicles.length} vehicle(s) ready.`);
  await pruneOldHeartbeats();
}

// ─── Subscription management ──────────────────────────────────────────────────

async function openSubscription(
  vehicle: { id: string; name: string; rivianVehicleId: string },
  tokens: RivianTokens
) {
  try {
    const subscription = await rivianApi.subscribeToVehicleState(
      tokens,
      vehicle.rivianVehicleId,
      (event) => {
        lastEventReceivedByVehicleId.set(vehicle.id, new Date());
        eventsThisTickByVehicleId.set(vehicle.id, (eventsThisTickByVehicleId.get(vehicle.id) ?? 0) + 1);
        const dedupeHash = createHash("sha256")
          .update(stableStringify({ observedAt: event.observedAt.toISOString(), raw: event.raw, vehicleId: vehicle.id }))
          .digest("hex");
        void persistVehicleStateEvent(database.db, vehicle.id, event.observedAt, event.raw, dedupeHash).then((isNew) => {
          const powerState = (event.raw.powerState as { value?: string } | undefined)?.value ?? null;
          const gearStatus = (event.raw.gearStatus as { value?: string } | undefined)?.value ?? null;
          if (isNew) {
            console.log(`[${vehicle.name}] Event stored: powerState=${powerState ?? "—"}, gear=${gearStatus ?? "—"}, observedAt=${event.observedAt.toISOString()}`);
          } else {
            console.log(`[${vehicle.name}] Duplicate event skipped: observedAt=${event.observedAt.toISOString()}`);
          }
        }).catch((error) => {
          console.error(`[${vehicle.name}] Failed to persist vehicle-state event.`, error);
        });
      },
      () => {
        // onClose — mark for re-subscribe on next tick
        if (!shuttingDown) {
          subscriptionClosedVehicleIds.add(vehicle.id);
          console.warn(`[${vehicle.name}] Subscription closed unexpectedly.`);
        }
      },
      (type, detail) => {
        if (type === "connected") {
          console.log(`[${vehicle.name}] WebSocket connected.`);
          return;
        }
        const message = type === "closed" ? "connection_closed" : "connection_error";
        const severity = type === "error" ? "error" : "warning";
        const logDetail = type === "closed"
          ? `code=${detail.code ?? "—"}, reason=${detail.reason ?? "—"}`
          : `error=${detail.message ?? "—"}`;
        console.warn(`[${vehicle.name}] WebSocket ${type}: ${logDetail}`);
        void database.db.insert(dataQualityEvents).values({
          category: "vehicle_subscription",
          message,
          raw: { ...detail, vehicleName: vehicle.name },
          severity,
          vehicleId: vehicle.id
        }).catch((err) => console.error(`[${vehicle.name}] Failed to log connection event.`, err));
      }
    );

    subscriptions.set(vehicle.id, subscription);
    await database.db.insert(dataQualityEvents).values({
      category: "vehicle_subscription",
      message: "subscribed",
      raw: { vehicleName: vehicle.name },
      severity: "info",
      vehicleId: vehicle.id
    });
    console.log(`Vehicle subscription opened for ${vehicle.name}.`);
  } catch (error) {
    await database.db.insert(dataQualityEvents).values({
      category: "vehicle_subscription",
      message: "subscribe_failed",
      raw: { error: error instanceof Error ? error.message : String(error), vehicleName: vehicle.name },
      severity: "error",
      vehicleId: vehicle.id
    });
    console.error(`Vehicle subscription failed for ${vehicle.name}.`, error);
  }
}

// ─── Charging fetch ───────────────────────────────────────────────────────────

async function fetchChargingIfDue(
  vehicle: { id: string; name: string; rivianVehicleId: string },
  tokens: RivianTokens
) {
  const now = Date.now();
  if (chargingLiveUnsupportedVehicleIds.has(vehicle.id)) return;
  if (now < (nextChargingFetchByVehicleId.get(vehicle.id) ?? 0)) return;

  try {
    const data = await rivianApi.fetchLiveChargingSession(tokens, vehicle.rivianVehicleId);
    const result = await persistChargingData(database.db, vehicle.id, data.observedAt, data.raw);

    chargingBackoffByVehicleId.set(vehicle.id, 0);
    nextChargingFetchByVehicleId.set(
      vehicle.id,
      now + 1000 * (result.pluggedIn ? config.CHARGING_PLUGGED_INTERVAL_SECONDS : config.CHARGING_UNPLUGGED_INTERVAL_SECONDS)
    );

    await database.db.insert(dataQualityEvents).values({
      category: "charging_fetch_success",
      message: result.hasSample ? "sample_stored" : "no_active_session",
      raw: { pluggedIn: result.pluggedIn, vehicleName: vehicle.name },
      severity: "info",
      vehicleId: vehicle.id
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Rivian removed the live charging endpoint
    if (message.includes("Cannot query field") && message.includes("getLiveSessionData")) {
      chargingLiveUnsupportedVehicleIds.add(vehicle.id);
      nextChargingFetchByVehicleId.set(vehicle.id, now + 1000 * 60 * 60 * 24);
      await database.db.insert(dataQualityEvents).values({
        category: "charging_fetch_unsupported",
        message: "live_charging_query_removed",
        raw: { vehicleName: vehicle.name },
        severity: "warning",
        vehicleId: vehicle.id
      });
      console.warn("Rivian live charging query is unavailable; using vehicle-state charging signals.");
      return;
    }

    // Rate-limit detection
    const isRateLimit =
      message.includes("429") ||
      message.includes("rate limit") ||
      message.toLowerCase().includes("too many requests");

    const backoff = isRateLimit
      ? Math.min((chargingBackoffByVehicleId.get(vehicle.id) || 60) * 2, 1800) // longer backoff for rate limits
      : Math.min((chargingBackoffByVehicleId.get(vehicle.id) || 30) * 2, 900);

    chargingBackoffByVehicleId.set(vehicle.id, backoff);
    nextChargingFetchByVehicleId.set(vehicle.id, now + backoff * 1000);

    await database.db.insert(dataQualityEvents).values({
      category: isRateLimit ? "rate_limit" : "charging_fetch_error",
      message: isRateLimit ? "rate_limited" : "fetch_failed",
      raw: { backoffSeconds: backoff, error: message, vehicleName: vehicle.name },
      severity: isRateLimit ? "warning" : "error",
      vehicleId: vehicle.id
    });

    if (isRateLimit) {
      console.warn(`Charging fetch rate-limited for ${vehicle.name}. Backing off ${backoff}s.`);
    } else {
      console.error(`Charging fetch failed for ${vehicle.name}.`, error);
    }
  }
}

// ─── Maintenance ──────────────────────────────────────────────────────────────

async function pruneOldHeartbeats() {
  const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 24);
  await database.db
    .delete(dataQualityEvents)
    .where(and(eq(dataQualityEvents.category, "collector_heartbeat"), lt(dataQualityEvents.observedAt, cutoff)));
}
