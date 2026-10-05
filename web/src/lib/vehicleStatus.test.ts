import type { VehicleState } from "@server/api-types.js";
import { describe, expect, it } from "vitest";
import { brakeFluidLabel, preconditioningLabel, securitySummary, vehicleActivity } from "./vehicleStatus.js";

const v = (value: string | number) => ({ timeStamp: "t", value });
const state = (fields: Record<string, string | number>) =>
  Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, v(x)])) as unknown as VehicleState;

describe("vehicleActivity", () => {
  it("prefers driving, then charging, then plugged in, asleep, parked", () => {
    expect(vehicleActivity(state({ gearStatus: "drive", chargerStatus: "chrgr_sts_connected_charging" }))?.kind).toBe("driving");
    expect(vehicleActivity(state({ powerState: "go", gnssSpeed: 5 }))?.kind).toBe("driving");
    expect(vehicleActivity(state({ gearStatus: "park", chargerStatus: "chrgr_sts_connected_charging" }))?.kind).toBe("charging");
    expect(vehicleActivity(state({ powerState: "sleep", chargerStatus: "chrgr_sts_connected_no_chrg" }))?.kind).toBe("plugged");
    expect(vehicleActivity(state({ powerState: "sleep", chargerStatus: "chrgr_sts_not_connected" }))?.kind).toBe("asleep");
    expect(vehicleActivity(state({ powerState: "ready", gearStatus: "park" }))?.kind).toBe("parked");
    expect(vehicleActivity(undefined)).toBeNull();
  });
});

describe("securitySummary", () => {
  it("is locked only when every reported lock is locked", () => {
    const locked = state({ doorFrontLeftClosed: "closed", doorFrontLeftLocked: "locked", closureFrunkClosed: "closed", closureFrunkLocked: "locked" });
    expect(securitySummary(locked, "R1S")).toMatchObject({ locked: true, open: [], openLabel: "All closed" });
    const unlocked = state({ doorFrontLeftClosed: "closed", doorFrontLeftLocked: "locked", closureFrunkClosed: "closed", closureFrunkLocked: "unlocked" });
    expect(securitySummary(unlocked, "R1S").locked).toBe(false);
    expect(securitySummary(state({}), "R1S").locked).toBeNull();
  });

  it("names a single opening and counts several", () => {
    expect(securitySummary(state({ closureLiftgateClosed: "open" }), "R1S").openLabel).toBe("Liftgate open");
    expect(
      securitySummary(state({ closureLiftgateClosed: "open", windowFrontLeftClosed: "open" }), "R1S").openLabel,
    ).toBe("2 open");
  });
});


describe("dashboard warning labels", () => {
  it("distinguishes explicit brake-fluid nulls, missing data and low-fluid warnings", () => {
    expect(brakeFluidLabel(undefined)).toBe("Unknown");
    expect(brakeFluidLabel({})).toBe("Unknown");
    expect(brakeFluidLabel({ brakeFluidLow: null } as unknown as VehicleState)).toBe("Normal");
    expect(brakeFluidLabel(state({ brakeFluidLow: "false" }))).toBe("OK");
    expect(brakeFluidLabel(state({ brakeFluidLow: "true" }))).toBe("Low");
  });

  it("maps the observed inactive preconditioning enum without masking missing or active values", () => {
    expect(preconditioningLabel(state({ cabinPreconditioningStatus: "undefined" }))).toBe("Off");
    expect(preconditioningLabel(undefined)).toBe("Unknown");
    expect(preconditioningLabel({ cabinPreconditioningStatus: null } as unknown as VehicleState)).toBe("Unknown");
    expect(preconditioningLabel(state({ cabinPreconditioningStatus: "active" }))).toBe("Active");
  });
});
