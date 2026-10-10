import type { VehicleState } from "@server/api-types.js";
import { brakeFluidLabel } from "./vehicleStatus.js";
import { lastInstallFailed, softwareUpdate } from "./ota.js";
import { sv, titleCase } from "./state.js";

/** good: nothing to do. info: worth knowing. attention: check it. */
export type CheckLevel = "good" | "info" | "attention" | "unknown";

export interface HealthCheck {
  key: string;
  label: string;
  level: CheckLevel;
  value: string;
}

export const TIRES = [
  { key: "fl", label: "Front left", status: "tirePressureStatusFrontLeft", pressure: "tirePressureFrontLeft" },
  { key: "fr", label: "Front right", status: "tirePressureStatusFrontRight", pressure: "tirePressureFrontRight" },
  { key: "rl", label: "Rear left", status: "tirePressureStatusRearLeft", pressure: "tirePressureRearLeft" },
  { key: "rr", label: "Rear right", status: "tirePressureStatusRearRight", pressure: "tirePressureRearRight" },
] as const;

export type TireKey = (typeof TIRES)[number]["key"];

/** A tire's level from the vehicle's own status (OK, LOW, …). */
export function tireLevel(status: string | null): CheckLevel {
  if (status == null || /^unknown$/i.test(status)) return "unknown";
  return status.toUpperCase() === "OK" ? "good" : "attention";
}

const unknown = (key: string, label: string): HealthCheck => ({ key, label, level: "unknown", value: "Unknown" });

function twelveVolt(state: VehicleState | undefined): HealthCheck {
  const value = sv(state, "twelveVoltBatteryHealth");
  if (value == null || /^unknown$/i.test(value)) return unknown("12v", "12V battery");
  // Observed: NORMAL_OPERATION.
  const ok = /^(normal|normal_operation|ok)$/i.test(value);
  return { key: "12v", label: "12V battery", level: ok ? "good" : "attention", value: ok ? "Normal" : titleCase(value.toLowerCase()) };
}

function brakeFluid(state: VehicleState | undefined): HealthCheck {
  const label = brakeFluidLabel(state);
  if (label === "Unknown") return unknown("brake", "Brake fluid");
  const ok = label === "OK" || label === "Normal";
  return { key: "brake", label: "Brake fluid", level: ok ? "good" : "attention", value: ok ? "Normal" : label };
}

function washerFluid(state: VehicleState | undefined): HealthCheck {
  const value = sv(state, "wiperFluidState");
  if (value == null) return unknown("washer", "Washer fluid");
  const ok = /^(normal|ok|full)$/i.test(value);
  return { key: "washer", label: "Washer fluid", level: ok ? "good" : "attention", value: ok ? "Normal" : titleCase(value.toLowerCase()) };
}

function tires(state: VehicleState | undefined): HealthCheck {
  const levels = TIRES.map((t) => ({ ...t, level: tireLevel(sv(state, t.status)) }));
  const flagged = levels.filter((t) => t.level === "attention");
  if (flagged.length > 0) {
    return {
      key: "tires",
      label: "Tires",
      level: "attention",
      value: flagged.length === 1 ? `Check ${flagged[0]!.label.toLowerCase()}` : `Check ${flagged.length} tires`,
    };
  }
  if (levels.every((t) => t.level === "unknown")) return unknown("tires", "Tires");
  return { key: "tires", label: "Tires", level: "good", value: "Normal" };
}

function packThermal(state: VehicleState | undefined): HealthCheck {
  const value = sv(state, "batteryHvThermalEvent");
  if (value == null) return unknown("pack", "Battery pack");
  // Observed: off. Anything else is a thermal event the vehicle reported.
  const ok = /^(off|none|false|normal)$/i.test(value);
  return { key: "pack", label: "Battery pack", level: ok ? "good" : "attention", value: ok ? "Normal" : "Thermal event" };
}

function software(state: VehicleState | undefined): HealthCheck {
  if (lastInstallFailed(state)) return { key: "software", label: "Software", level: "attention", value: "Install failed" };
  const update = softwareUpdate(state);
  if (update) return { key: "software", label: "Software", level: "info", value: update.label };
  if (!sv(state, "otaCurrentVersion")) return unknown("software", "Software");
  return { key: "software", label: "Software", level: "good", value: "Up to date" };
}

/** Everything the vehicle reports about its own condition, in display order. */
export function healthChecks(state: VehicleState | undefined): HealthCheck[] {
  return [packThermal(state), twelveVolt(state), tires(state), brakeFluid(state), washerFluid(state), software(state)];
}

export interface HealthSummary {
  level: CheckLevel;
  title: string;
  detail: string;
}

/** One line on how the vehicle is doing overall. */
export function healthSummary(checks: readonly HealthCheck[]): HealthSummary {
  const attention = checks.filter((c) => c.level === "attention");
  if (attention.length > 0) {
    return {
      level: "attention",
      title: attention.length === 1 ? "One thing needs a look" : `${attention.length} things need a look`,
      detail: attention.map((c) => `${c.label}: ${c.value.toLowerCase()}`).join(" · "),
    };
  }
  if (checks.every((c) => c.level === "unknown")) {
    return { level: "unknown", title: "Waiting for the vehicle", detail: "Health readings appear once the vehicle reports in." };
  }
  const missing = checks.filter((c) => c.level === "unknown").length;
  return {
    level: "good",
    title: "Everything looks good",
    detail:
      missing > 0
        ? "No warnings in what the vehicle has reported so far."
        : "No warnings from the battery, tires, fluids or software.",
  };
}

/** Bar: about 1.5 psi. A tire that drops this much more than the others is losing air. */
const LEAK_BAR = 0.1;
const MIN_SPAN_MS = 2 * 86_400_000;
const MIN_POINTS = 6;

export interface TireTrend {
  /** Change per tire in bar, first fifth of the window to the last. */
  change: Record<TireKey, number | null>;
  /** A tire dropping clearly faster than the rest, if any. */
  leaking: TireKey | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length / 2;
  return s.length % 2 ? s[Math.floor(mid)]! : (s[mid - 1]! + s[mid]!) / 2;
};

/**
 * How each tire's pressure moved over a window. Temperature moves all four
 * together, so a slow leak shows as one tire falling against the others'
 * median rather than as a fall on its own. Null when the window is too
 * short or sparse to say.
 */
export function tireTrend(points: readonly ({ ts: number } & Partial<Record<TireKey, number | null>>)[]): TireTrend | null {
  if (points.length < MIN_POINTS) return null;
  if (points[points.length - 1]!.ts - points[0]!.ts < MIN_SPAN_MS) return null;
  const n = Math.max(1, Math.floor(points.length / 5));
  const head = points.slice(0, n);
  const tail = points.slice(-n);
  const values = (rows: typeof points, key: TireKey) =>
    rows.map((r) => r[key]).filter((v): v is number => v != null && Number.isFinite(v));

  const change = {} as Record<TireKey, number | null>;
  for (const { key } of TIRES) {
    const start = mean(values(head, key));
    const end = mean(values(tail, key));
    change[key] = start != null && end != null ? end - start : null;
  }
  const known = TIRES.map((t) => t.key).filter((k) => change[k] != null);
  let leaking: TireKey | null = null;
  if (known.length >= 3) {
    const typical = median(known.map((k) => change[k]!));
    let worst = -LEAK_BAR;
    for (const k of known) {
      const relative = change[k]! - typical;
      if (relative <= worst) {
        worst = relative;
        leaking = k;
      }
    }
  }
  return { change, leaking };
}

export interface CapacityTrend {
  latestKwh: number;
  /** Latest minus the first reading; null with a single reading. */
  changeKwh: number | null;
  since: string | null;
}

/** Reported capacity now against the first reading on record. */
export function capacityTrend(readings: readonly { at: string; kwh: number }[]): CapacityTrend | null {
  const first = readings[0];
  const last = readings[readings.length - 1];
  if (!first || !last) return null;
  return {
    latestKwh: last.kwh,
    changeKwh: readings.length > 1 ? last.kwh - first.kwh : null,
    since: readings.length > 1 ? first.at : null,
  };
}

/** Reported usable capacity as a percentage of the pack's rated capacity. */
export function capacityOfRated(capacityKwh: number | null | undefined, ratedKwh: number | null | undefined): number | null {
  if (capacityKwh == null || ratedKwh == null || !(ratedKwh > 0) || !(capacityKwh > 0)) return null;
  return (capacityKwh / ratedKwh) * 100;
}
