import { eq, lt } from 'drizzle-orm';
import type { VehicleInsightsDto } from '../api-types.js';
import type { Db } from '../db/client.js';
import { parallaxLatest, parallaxMessages } from '../db/schema.js';
import {
  type Decoded,
  PARALLAX_LOGGED_RVMS,
  PARALLAX_STORED_RVMS,
  type ParallaxMessage,
  type RvmDef,
  batteryState,
  coldWeather,
  decodeMessage,
  isTopic,
  messageTime,
  network,
  parkedEnergy,
  tripInfo,
  tripProgress,
} from '../rivian/parallax/index.js';

const LOG_RETENTION_MS = 30 * 24 * 3600_000;
const PRUNE_EVERY_MS = 3600_000;

/** Suffix for the last battery state that carried cell temperatures. */
const AWAKE = ':awake';

/**
 * Keeps the latest Parallax message per vehicle and topic, for topics whose
 * definition asks for it (`store`). Repeats of the same payload aren't
 * rewritten, so a chatty topic costs no writes.
 */
export class ParallaxStore {
  private lastPayload = new Map<string, string>();
  private prunedAt = 0;

  constructor(
    private readonly db: Db,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  async ingest(
    vehicleId: string,
    message: ParallaxMessage,
    decoded: Decoded | null = decodeMessage(message),
  ): Promise<void> {
    if (!PARALLAX_STORED_RVMS.has(message.rvm)) return;
    const rows = [message.rvm];
    if (isTopic(decoded, batteryState) && decoded.value?.cellTemps) {
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
          .onConflictDoUpdate({
            target: [parallaxLatest.vehicleId, parallaxLatest.rvm],
            set: values,
          });
        if (PARALLAX_LOGGED_RVMS.has(rvm)) {
          await this.db.insert(parallaxMessages).values({ vehicleId, rvm, ...values });
          await this.pruneLog(values.receivedAt);
        }
        this.lastPayload.set(cacheKey, message.payload);
      }
    } catch (err) {
      this.log(`parallax store failed for ${message.rvm}: ${String(err)}`);
    }
  }

  /** Drops logged payloads past retention, at most hourly. */
  private async pruneLog(now: Date): Promise<void> {
    if (now.getTime() - this.prunedAt < PRUNE_EVERY_MS) return;
    this.prunedAt = now.getTime();
    await this.db
      .delete(parallaxMessages)
      .where(lt(parallaxMessages.receivedAt, new Date(now.getTime() - LOG_RETENTION_MS)));
  }

  async insights(vehicleId: string): Promise<VehicleInsightsDto> {
    const rows = await this.db
      .select()
      .from(parallaxLatest)
      .where(eq(parallaxLatest.vehicleId, vehicleId));
    const byRvm = new Map(rows.map((r) => [r.rvm, r]));
    const at = (r: (typeof rows)[number]) => (r.messageAt ?? r.receivedAt).toISOString();
    const read = <T>(def: RvmDef<T>, suffix = '') => {
      const row = byRvm.get(def.rvm + suffix);
      const value = row ? (def.decode?.(row.payload) ?? null) : null;
      return row && value != null ? { value, at: at(row) } : null;
    };

    const battery = read(batteryState);
    const awake = read(batteryState, AWAKE);
    const cold = read(coldWeather);
    const parked = read(parkedEnergy);
    const net = read(network);
    // Progress outlives the trip, so navigation needs an active trip_info.
    const trip = read(tripInfo);
    const progress = trip ? read(tripProgress) : null;
    return {
      cellTemps: awake?.value.cellTemps ? { ...awake.value.cellTemps, at: awake.at } : null,
      cellTempsCurrent: battery?.value.cellTemps != null,
      coldWeather: cold ? { ...cold.value, at: cold.at } : null,
      parkedEnergy:
        parked && parked.value.length > 0 ? { windows: parked.value, at: parked.at } : null,
      connectivity: net ? { ...net.value, at: net.at } : null,
      navigation: trip
        ? {
            ...trip.value,
            etaAt:
              progress?.value.etaMs != null ? new Date(progress.value.etaMs).toISOString() : null,
            remainingKm: progress?.value.remainingKm ?? trip.value.totalDistanceKm,
            remainingS: progress?.value.remainingS ?? trip.value.totalDurationS,
            at: progress?.at ?? trip.at,
          }
        : null,
    };
  }
}
