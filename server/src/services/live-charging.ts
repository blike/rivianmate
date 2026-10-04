import type { LiveSessionData, LiveSessionValueRecord } from "../rivian/types.js";
import { isChargingState } from "./charging-time.js";

/**
 * Where a live charging reading came from. The push feed is Rivian's own
 * session summary, so it breaks ties; Parallax is the vehicle's own
 * telemetry; legacy vehicle state is the slowest to update.
 */
export type LiveSource = "push" | "parallax" | "state";

const PRIORITY: Record<LiveSource, number> = { push: 3, parallax: 2, state: 1 };

export type LiveField =
  | "chargerState"
  | "powerKw"
  | "soc"
  | "secondsLeft"
  | "energyKwh"
  | "rangeAddedKm"
  | "rangeKmPerHour"
  | "socLimit"
  | "capacityKwh";

type FieldValue = number | string | null;

/**
 * Readings older than this are unknown rather than shown: a source that
 * stops reporting mid-charge must not leave a frozen number on screen.
 * Generous, because an L2 charge can go many minutes between readings.
 */
export const STALE_MS = 20 * 60_000;

/** Fields that describe the moment; the rest stay true until they change. */
const PERISHABLE = new Set<LiveField>([
  "powerKw",
  "secondsLeft",
  "energyKwh",
  "rangeAddedKm",
  "rangeKmPerHour",
]);

/** Push-feed states that mean a session is under way. */
const PUSH_ACTIVE_STATES = new Set(["charging_active", "charging_connecting", "charging_ready", "charging"]);

interface Observation {
  value: FieldValue;
  /** When the source observed it, never later than when it arrived. */
  at: number;
}

export interface Resolved<T extends FieldValue = FieldValue> {
  value: T;
  at: number;
  source: LiveSource;
}

/** What only the push feed knows about a session. */
export type PushDetails = Pick<
  LiveSessionData,
  "chargerId" | "currentCurrency" | "currentPrice" | "isFreeSession" | "isRivianCharger" | "locationId" | "timeElapsed"
>;

/**
 * One vehicle's live charging readings, kept per field and per source.
 *
 * Each source's latest observation of each field is kept, and an
 * observation older than the one already held from that source is ignored,
 * so readings arriving out of order can't move a value back in time. When
 * the session is read, each field takes the newest fresh observation from
 * any source (ties go to the more authoritative source). Sources only ever
 * report what they actually observed: an absent reading is never a zero.
 */
export class LiveChargeState {
  private readonly observations = new Map<string, Observation>();
  private push: PushDetails | null = null;

  /** Records a reading; false if the source already reported something newer. */
  observe(field: LiveField, source: LiveSource, value: FieldValue, at: number, now: number): boolean {
    const key = `${field}|${source}`;
    const stamped = Number.isFinite(at) ? Math.min(at, now) : now;
    const previous = this.observations.get(key);
    if (previous && stamped < previous.at) return false;
    // A lasting value dates from when it changed: vehicle state re-stamps
    // unchanged values on every report, which mustn't outrank a newer change
    // from another source. Momentary readings refresh with every report.
    if (previous && !PERISHABLE.has(field) && previous.value === value) return true;
    this.observations.set(key, { value, at: stamped });
    return true;
  }

  /**
   * Drops one charge's readings (power, energy, time left) observed before
   * `before`, so a new plug-in never shows the last one's figures. Readings
   * from the new charge that arrived first are kept.
   */
  forgetSessionReadings(before: number): void {
    for (const [key, o] of [...this.observations]) {
      if (PERISHABLE.has(key.split("|")[0] as LiveField) && o.at < before) this.observations.delete(key);
    }
  }

  /** The push feed reports an active session: what it alone carries. */
  setPushDetails(details: PushDetails): void {
    this.push = details;
  }

  /**
   * The push feed reports no session. It no longer vouches that a charge is
   * running, but its last readings were real and age out like any other:
   * a feed that flaps mid-charge mustn't blank the dashboard.
   */
  clearPush(): void {
    this.push = null;
    this.observations.delete("chargerState|push");
  }

  /** The newest fresh observation of a field across sources. */
  resolve<T extends FieldValue = FieldValue>(field: LiveField, now: number): Resolved<T> | null {
    let best: Resolved | null = null;
    for (const source of Object.keys(PRIORITY) as LiveSource[]) {
      const o = this.observations.get(`${field}|${source}`);
      if (!o) continue;
      if (PERISHABLE.has(field) && now - o.at > STALE_MS) continue;
      if (
        !best ||
        o.at > best.at ||
        (o.at === best.at && PRIORITY[source] > PRIORITY[best.source])
      ) {
        best = { value: o.value, at: o.at, source };
      }
    }
    return best as Resolved<T> | null;
  }

  /** Whether the latest charger state, from any source, says it's charging. */
  isCharging(now: number): boolean {
    const state = this.resolve<string | null>("chargerState", now);
    if (!state || typeof state.value !== "string") return false;
    return state.source === "push"
      ? PUSH_ACTIVE_STATES.has(state.value.toLowerCase())
      : isChargingState(state.value);
  }

  /**
   * The live session to show, or null when not charging. One merged
   * object, so the dashboard never flips between sources wholesale.
   */
  session(startedAt: number, now: number): LiveSessionData | null {
    if (!this.isCharging(now)) return null;
    const rec = (field: LiveField, scale = 1): LiveSessionValueRecord | null => {
      const r = this.resolve(field, now);
      if (r == null || r.value == null) return null;
      const value = typeof r.value === "number" ? r.value * scale : r.value;
      return { value, updatedAt: new Date(r.at).toISOString() };
    };
    const secondsLeft = rec("secondsLeft");
    return {
      chargerId: this.push?.chargerId ?? null,
      currentCurrency: this.push?.currentCurrency ?? null,
      currentPrice: this.push?.currentPrice ?? null,
      isFreeSession: this.push?.isFreeSession ?? null,
      isRivianCharger: this.push?.isRivianCharger ?? null,
      locationId: this.push?.locationId ?? null,
      startTime: new Date(startedAt).toISOString(),
      timeElapsed: this.push?.timeElapsed ?? null,
      power: rec("powerKw"),
      soc: rec("soc"),
      // 0 means no estimate (e.g. a schedule is about to stop the charge).
      timeRemaining: secondsLeft && secondsLeft.value !== 0 ? secondsLeft : null,
      totalChargedEnergy: rec("energyKwh"),
      rangeAddedThisSession: rec("rangeAddedKm"),
      kilometersChargedPerHour: rec("rangeKmPerHour"),
      socLimit: rec("socLimit"),
      batteryCapacityKwh: rec("capacityKwh"),
      vehicleChargerState: rec("chargerState"),
      chart: [],
    };
  }
}
