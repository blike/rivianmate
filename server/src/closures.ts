/**
 * Closure readings (doors, gates, windows), shared by the web app and the
 * server's notifications.
 */
import type { VehicleState } from "./rivian/types.js";

function sv(state: VehicleState | undefined, key: string): string | null {
  const value = (state?.[key] as { value?: unknown } | null | undefined)?.value;
  return value == null ? null : String(value);
}

export type VehicleBody = "truck" | "suv" | null;

/**
 * R1T is a pickup (tailgate, tonneau, gear tunnels); R1S and R2 are SUVs
 * (liftgate). Unknown models return null so only reported closures show.
 */
export function vehicleBody(model: string | null | undefined): VehicleBody {
  const m = model?.trim().toUpperCase() ?? "";
  if (m.includes("R1T")) return "truck";
  if (m.includes("R1S") || m.includes("R2")) return "suv";
  return null;
}

/** Rivian sends placeholders for absent parts; anything unrecognized is unknown. */
export function closedValue(raw: string | null): boolean | null {
  switch (raw?.trim().toLowerCase()) {
    case "closed":
    case "true":
      return true;
    case "open":
    case "opened":
    case "false":
      return false;
    default:
      return null;
  }
}

export function lockedValue(raw: string | null): boolean | null {
  switch (raw?.trim().toLowerCase()) {
    case "locked":
    case "true":
      return true;
    case "unlocked":
    case "false":
      return false;
    default:
      return null;
  }
}

interface ClosureDef {
  label: string;
  closedKey: string;
  lockedKey?: string;
  /** Only shown for this body style (when the model is known). */
  body?: Exclude<VehicleBody, null>;
}

const CLOSURES: ClosureDef[] = [
  { label: "Driver door", closedKey: "doorFrontLeftClosed", lockedKey: "doorFrontLeftLocked" },
  { label: "Passenger door", closedKey: "doorFrontRightClosed", lockedKey: "doorFrontRightLocked" },
  { label: "Rear left door", closedKey: "doorRearLeftClosed", lockedKey: "doorRearLeftLocked" },
  { label: "Rear right door", closedKey: "doorRearRightClosed", lockedKey: "doorRearRightLocked" },
  { label: "Frunk", closedKey: "closureFrunkClosed", lockedKey: "closureFrunkLocked" },
  { label: "Tailgate", closedKey: "closureTailgateClosed", lockedKey: "closureTailgateLocked", body: "truck" },
  { label: "Liftgate", closedKey: "closureLiftgateClosed", lockedKey: "closureLiftgateLocked", body: "suv" },
  { label: "Tonneau", closedKey: "closureTonneauClosed", lockedKey: "closureTonneauLocked", body: "truck" },
  { label: "Gear tunnel L", closedKey: "closureSideBinLeftClosed", lockedKey: "closureSideBinLeftLocked", body: "truck" },
  { label: "Gear tunnel R", closedKey: "closureSideBinRightClosed", lockedKey: "closureSideBinRightLocked", body: "truck" },
];

const WINDOWS: ClosureDef[] = [
  { label: "Window FL", closedKey: "windowFrontLeftClosed" },
  { label: "Window FR", closedKey: "windowFrontRightClosed" },
  { label: "Window RL", closedKey: "windowRearLeftClosed" },
  { label: "Window RR", closedKey: "windowRearRightClosed" },
];

export interface ClosureStatus {
  key: string;
  label: string;
  closed: boolean;
  locked: boolean | null;
}

function forBody(defs: ClosureDef[], body: VehicleBody) {
  return defs.filter((def) => !(def.body && body && def.body !== body));
}

function resolve(defs: ClosureDef[], state: VehicleState | undefined, body: VehicleBody) {
  const rows: ClosureStatus[] = [];
  for (const def of forBody(defs, body)) {
    const closed = closedValue(sv(state, def.closedKey));
    // Hide parts with no recognizable reading (absent on this vehicle or not reported).
    if (closed === null) continue;
    rows.push({
      key: def.closedKey,
      label: def.label,
      closed,
      locked: def.lockedKey ? lockedValue(sv(state, def.lockedKey)) : null,
    });
  }
  return rows;
}

export function closureStatuses(state: VehicleState | undefined, model: string | null | undefined) {
  const body = vehicleBody(model);
  return {
    closures: resolve(CLOSURES, state, body),
    windows: resolve(WINDOWS, state, body),
  };
}

/** Rows this body type can show, for laying out the panel before state loads. */
export function closurePlaceholders(model: string | null | undefined) {
  const body = vehicleBody(model);
  const rows = (defs: ClosureDef[]): ClosureStatus[] =>
    forBody(defs, body).map((def) => ({ key: def.closedKey, label: def.label, closed: true, locked: null }));
  return { closures: rows(CLOSURES), windows: rows(WINDOWS) };
}
