import { describe, expect, it } from "vitest";
import { closedValue, closureStatuses, lockedValue, vehicleBody } from "./closures.js";

const v = (value: string) => ({ timeStamp: "t", value });

describe("closures", () => {
  it("maps models to body styles", () => {
    expect(vehicleBody("R1T")).toBe("truck");
    expect(vehicleBody("R1S")).toBe("suv");
    expect(vehicleBody("R2")).toBe("suv");
    expect(vehicleBody(null)).toBeNull();
  });

  it("treats placeholder values as unknown", () => {
    expect(closedValue("undefined")).toBeNull();
    expect(closedValue("signal_not_available")).toBeNull();
    expect(closedValue("open")).toBe(false);
    expect(lockedValue("undefined")).toBeNull();
    expect(lockedValue("unlocked")).toBe(false);
  });

  it("hides truck-only parts on an SUV and unknown readings everywhere", () => {
    const state = {
      doorFrontLeftClosed: v("closed"),
      doorFrontLeftLocked: v("undefined"),
      closureLiftgateClosed: v("closed"),
      closureTailgateClosed: v("open"),
      closureTonneauClosed: v("undefined"),
    };
    const suv = closureStatuses(state, "R1S").closures.map((c) => c.label);
    expect(suv).toEqual(["Driver door", "Liftgate"]);
    const truck = closureStatuses(state, "R1T").closures.map((c) => c.label);
    expect(truck).toEqual(["Driver door", "Tailgate"]);
    expect(closureStatuses(state, "R1S").closures[0]!.locked).toBeNull();
  });
});
