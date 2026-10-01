import type { LiveSessionData, LiveSessionValueRecord } from "./types.js";

type Leaf = unknown;

/** Leaves arrive either as scalars or as `{ value, updatedAt }` envelopes. */
function unwrap(leaf: Leaf): { value: unknown; updatedAt?: string } | undefined {
  if (leaf === undefined || leaf === null) return undefined;
  if (typeof leaf === "object" && "value" in (leaf as Record<string, unknown>)) {
    const envelope = leaf as { value: unknown; updatedAt?: unknown };
    return {
      value: envelope.value,
      updatedAt:
        typeof envelope.updatedAt === "string" ? envelope.updatedAt : undefined,
    };
  }
  return { value: leaf };
}

function asNumber(leaf: Leaf): number | null {
  const raw = unwrap(leaf)?.value;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function asString(leaf: Leaf): string | null {
  const raw = unwrap(leaf)?.value;
  if (raw === undefined || raw === null) return null;
  return String(raw);
}

function asBool(leaf: Leaf): boolean | null {
  const raw = unwrap(leaf)?.value;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    if (raw.toLowerCase() === "true") return true;
    if (raw.toLowerCase() === "false") return false;
  }
  return null;
}

function record(
  value: string | number | null,
  leaf: Leaf,
  fallbackTs: string,
): LiveSessionValueRecord | null {
  if (value === null) return null;
  return { value, updatedAt: unwrap(leaf)?.updatedAt ?? fallbackTs };
}

/**
 * Maps a `chargingSession` subscription payload into the LiveSessionData
 * shape used by persistence and the UI. Returns null when there is no
 * active session (explicit null, or no liveData).
 */
export function mapChargingSession(
  payload: unknown,
  now: () => Date = () => new Date(),
): LiveSessionData | null {
  if (!payload || typeof payload !== "object") return null;
  const session = payload as { liveData?: unknown; chartData?: unknown };
  const live = session.liveData as Record<string, Leaf> | null | undefined;
  if (!live || typeof live !== "object") return null;

  const ts = now().toISOString();
  const chart = Array.isArray(session.chartData)
    ? (session.chartData as Record<string, Leaf>[])
    : [];
  // Latest observed SoC comes from the most recent chart point.
  let soc: number | null = null;
  let socLeaf: Leaf;
  for (let i = chart.length - 1; i >= 0 && soc === null; i--) {
    soc = asNumber(chart[i]?.soc);
    socLeaf = chart[i]?.soc;
  }

  const power = asNumber(live.powerKW);
  const chargerState = asString(live.vehicleChargerState);
  return {
    chargerId: null,
    currentCurrency: asString(live.currency),
    currentPrice: asNumber(live.price),
    isFreeSession: asBool(live.isFreeSession),
    isRivianCharger: null,
    locationId: null,
    startTime: asString(live.startTime),
    timeElapsed: asNumber(live.timeElapsed),
    kilometersChargedPerHour: record(
      asNumber(live.kilometersChargedPerHour),
      live.kilometersChargedPerHour,
      ts,
    ),
    power: record(power, live.powerKW, ts),
    rangeAddedThisSession: record(
      asNumber(live.rangeAddedThisSession),
      live.rangeAddedThisSession,
      ts,
    ),
    soc: record(soc, socLeaf, ts),
    timeRemaining: record(asNumber(live.timeRemaining), live.timeRemaining, ts),
    totalChargedEnergy: record(
      asNumber(live.totalChargedEnergy),
      live.totalChargedEnergy,
      ts,
    ),
    vehicleChargerState: record(chargerState, live.vehicleChargerState, ts),
  };
}
