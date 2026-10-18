import { and, eq } from 'drizzle-orm';
import type { VehicleInsightsDto } from '../api-types.js';
import type { Db } from '../db/client.js';
import { type Logger, silentLogger } from '../logger.js';
import { parallaxLatest } from '../db/schema.js';
import {
  type Decoded,
  PARALLAX_STORED_RVMS,
  type ParallaxMessage,
  type RvmDef,
  type TripInfo,
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

/** Suffix for the last battery state that carried cell temperatures. */
const AWAKE = ':awake';

/**
 * Keeps the latest Parallax message per vehicle and topic, for topics whose
 * definition asks for it (`store`). Repeats of the same payload aren't
 * rewritten, so a chatty topic costs no writes.
 */
export class ParallaxStore {
  private lastPayload = new Map<string, string>();

  constructor(
    private readonly db: Db,
    private readonly log: Logger = silentLogger,
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
        this.lastPayload.set(cacheKey, message.payload);
      }
    } catch (err) {
      this.log.error({ err, rvm: message.rvm }, 'storing message failed');
    }
  }

  /** A topic's latest decoded message for a vehicle, and when Rivian sent it. */
  async latest<T>(vehicleId: string, def: RvmDef<T>): Promise<{ value: T; at: Date } | null> {
    const [row] = await this.db
      .select()
      .from(parallaxLatest)
      .where(and(eq(parallaxLatest.vehicleId, vehicleId), eq(parallaxLatest.rvm, def.rvm)));
    const value = row ? (def.decode?.(row.payload) ?? null) : null;
    return row && value != null ? { value, at: row.messageAt ?? row.receivedAt } : null;
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
            ...tripWithoutArrival(trip.value),
            // Progress updates the ETA as the drive goes; the route's own is from planning.
            etaAt: etaIso(progress?.value.etaMs ?? trip.value.arrivalAtMs),
            remainingKm: progress?.value.remainingKm ?? trip.value.totalDistanceKm,
            remainingS: progress?.value.remainingS ?? trip.value.totalDurationS,
            at: progress?.at ?? trip.at,
          }
        : null,
    };
  }
}

const tripWithoutArrival = ({ arrivalAtMs: _, ...trip }: TripInfo) => trip;
const etaIso = (ms: number | null) => (ms != null ? new Date(ms).toISOString() : null);
