import { eq } from "drizzle-orm";
import type { VehicleInsightsDto } from "../api-types.js";
import type { Db } from "../db/client.js";
import { parallaxLatest } from "../db/schema.js";
import {
  type ParallaxMessage,
  RVM_BATTERY_STATE,
  RVM_CHARGE_BREAKDOWN,
  RVM_COLD_WEATHER,
  RVM_NETWORK,
  RVM_PARKED_ENERGY,
  RVM_TRIP_INFO,
  RVM_TRIP_PROGRESS,
  decodeBatteryState,
  decodeColdWeather,
  decodeNetwork,
  decodeParkedEnergy,
  decodeTripInfo,
  decodeTripProgress,
} from "../rivian/parallax.js";

/** Topics kept for the insights view (the charging graph is stored as curves). */
const STORED_RVMS = new Set([
  RVM_BATTERY_STATE,
  RVM_CHARGE_BREAKDOWN,
  RVM_COLD_WEATHER,
  RVM_PARKED_ENERGY,
  RVM_NETWORK,
  RVM_TRIP_INFO,
  RVM_TRIP_PROGRESS,
]);
/** Rivian's message time; seconds or milliseconds since the epoch. */
function messageTime(timestamp: number | null): Date | null {
  if (!timestamp) return null;
  return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
}

/** Suffix for the last battery state that carried cell temperatures. */
const AWAKE = ":awake";

/**
 * Keeps the latest Parallax message per vehicle and topic. Repeats of the
 * same payload aren't rewritten, so a chatty topic costs no writes.
 */
export class ParallaxStore {
  private lastPayload = new Map<string, string>();

  constructor(
    private readonly db: Db,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  async ingest(vehicleId: string, message: ParallaxMessage): Promise<void> {
    if (!STORED_RVMS.has(message.rvm)) return;
    const rows = [message.rvm];
    if (message.rvm === RVM_BATTERY_STATE && decodeBatteryState(message.payload)?.cellTemps) {
      rows.push(message.rvm + AWAKE);
    }
    try {
      for (const rvm of rows) {
        const cacheKey = `${vehicleId}|${rvm}`;
        if (this.lastPayload.get(cacheKey) === message.payload) continue;
        const values = {
          payload: message.payload,
          messageAt: messageTime(message.timestamp),
          receivedAt: new Date(),
        };
        await this.db
          .insert(parallaxLatest)
          .values({ vehicleId, rvm, ...values })
          .onConflictDoUpdate({ target: [parallaxLatest.vehicleId, parallaxLatest.rvm], set: values });
        this.lastPayload.set(cacheKey, message.payload);
      }
    } catch (err) {
      this.log(`parallax store failed for ${message.rvm}: ${String(err)}`);
    }
  }

  async insights(vehicleId: string): Promise<VehicleInsightsDto> {
    const rows = await this.db
      .select()
      .from(parallaxLatest)
      .where(eq(parallaxLatest.vehicleId, vehicleId));
    const byRvm = new Map(rows.map((r) => [r.rvm, r]));
    const at = (r: (typeof rows)[number]) => (r.messageAt ?? r.receivedAt).toISOString();
    const read = <T>(rvm: string, decodeFn: (payload: string) => T | null) => {
      const row = byRvm.get(rvm);
      const value = row ? decodeFn(row.payload) : null;
      return row && value != null ? { value, at: at(row) } : null;
    };

    const battery = read(RVM_BATTERY_STATE, decodeBatteryState);
    const awake = read(RVM_BATTERY_STATE + AWAKE, decodeBatteryState);
    const cold = read(RVM_COLD_WEATHER, decodeColdWeather);
    const parked = read(RVM_PARKED_ENERGY, decodeParkedEnergy);
    const network = read(RVM_NETWORK, decodeNetwork);
    // Progress outlives the trip, so navigation needs an active trip_info.
    const trip = read(RVM_TRIP_INFO, decodeTripInfo);
    const progress = trip ? read(RVM_TRIP_PROGRESS, decodeTripProgress) : null;
    return {
      cellTemps: awake?.value.cellTemps ? { ...awake.value.cellTemps, at: awake.at } : null,
      cellTempsCurrent: battery?.value.cellTemps != null,
      coldWeather: cold ? { ...cold.value, at: cold.at } : null,
      parkedEnergy: parked && parked.value.length > 0 ? { windows: parked.value, at: parked.at } : null,
      connectivity: network ? { ...network.value, at: network.at } : null,
      navigation: trip
        ? {
            ...trip.value,
            etaAt: progress?.value.etaMs != null ? new Date(progress.value.etaMs).toISOString() : null,
            remainingKm: progress?.value.remainingKm ?? trip.value.totalDistanceKm,
            remainingS: progress?.value.remainingS ?? trip.value.totalDurationS,
            at: progress?.at ?? trip.at,
          }
        : null,
    };
  }
}
