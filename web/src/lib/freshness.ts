import type { VehicleState } from "@server/api-types.js";

export type FreshnessLevel = "live" | "recent" | "asleep" | "stale";

export interface Freshness {
  level: FreshnessLevel;
  lastSeen: Date | null;
  label: string;
}

const STALE_MS = 24 * 3600_000;
const LIVE_MS = 10 * 60_000;
/** GPS this far behind the vehicle's other readings is out of date. */
const LOCATION_LAG_MS = 10 * 60_000;

/** Most recent time the vehicle reported anything (`except` these fields). */
export function lastSeenAt(
  state: VehicleState | undefined,
  except: (key: string) => boolean = () => false,
): Date | null {
  if (!state) return null;
  let latest = 0;
  const consider = (iso: unknown) => {
    if (typeof iso !== "string") return;
    const t = Date.parse(iso);
    if (Number.isFinite(t) && t > latest) latest = t;
  };
  consider(state.cloudConnection?.lastSync);
  for (const [key, value] of Object.entries(state)) {
    if (except(key)) continue;
    if (value && typeof value === "object" && "timeStamp" in value) {
      consider((value as { timeStamp?: unknown }).timeStamp);
    }
  }
  return latest > 0 ? new Date(latest) : null;
}

/**
 * Whether the GPS fix is well behind the vehicle's other readings: Rivian
 * keeps showing the last fix while the vehicle has no GPS signal.
 */
export function locationIsBehind(state: VehicleState | undefined): boolean {
  const fixAt = Date.parse(state?.gnssLocation?.timeStamp ?? "");
  const othersAt = lastSeenAt(state, (key) => key.startsWith("gnss"));
  return Number.isFinite(fixAt) && othersAt !== null && othersAt.getTime() - fixAt > LOCATION_LAG_MS;
}

export function relativeTime(date: Date, now: number): string {
  const s = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function freshness(state: VehicleState | undefined, now = Date.now()): Freshness {
  const lastSeen = lastSeenAt(state);
  if (!lastSeen) return { level: "stale", lastSeen: null, label: "No data yet" };
  const age = now - lastSeen.getTime();
  const ago = relativeTime(lastSeen, now);
  const online = state?.cloudConnection?.isOnline;
  if (age > STALE_MS) return { level: "stale", lastSeen, label: `No updates · last seen ${ago}` };
  if (online === false) return { level: "asleep", lastSeen, label: `Asleep · last seen ${ago}` };
  if (age <= LIVE_MS) return { level: "live", lastSeen, label: `Online · updated ${ago}` };
  return { level: "recent", lastSeen, label: `Online · updated ${ago}` };
}
