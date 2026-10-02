import type { VehicleState } from "@server/api-types.js";
import { closureStatuses } from "./closures.js";
import { nv, sv } from "./state.js";

export type ActivityKind = "driving" | "charging" | "plugged" | "parked" | "asleep";

/** What the vehicle is doing right now, for the dashboard's headline chip. */
export function vehicleActivity(state: VehicleState | undefined): { kind: ActivityKind; label: string } | null {
  if (!state) return null;
  const gear = sv(state, "gearStatus");
  const power = sv(state, "powerState");
  const speed = nv(state, "gnssSpeed") ?? 0; // m/s
  const charger = sv(state, "chargerStatus");
  if (gear === "drive" || gear === "reverse" || (power === "go" && speed > 1)) {
    return { kind: "driving", label: "Driving" };
  }
  if (charger === "chrgr_sts_connected_charging") return { kind: "charging", label: "Charging" };
  if (charger === "chrgr_sts_connected_no_chrg") return { kind: "plugged", label: "Plugged in" };
  if (power === "sleep") return { kind: "asleep", label: "Asleep" };
  return { kind: "parked", label: "Parked" };
}

/**
 * Locks and openings at a glance. `locked` is false if anything lockable is
 * unlocked, null if nothing reports a lock state.
 */
export function securitySummary(state: VehicleState | undefined, model: string | null | undefined) {
  const { closures, windows } = closureStatuses(state, model);
  const locks = closures.map((c) => c.locked).filter((l) => l !== null);
  const locked = locks.length === 0 ? null : locks.every(Boolean);
  const open = [...closures, ...windows].filter((c) => !c.closed).map((c) => c.label);
  const openLabel =
    open.length === 0 ? "All closed" : open.length === 1 ? `${open[0]} open` : `${open.length} open`;
  return { locked, open, openLabel };
}
