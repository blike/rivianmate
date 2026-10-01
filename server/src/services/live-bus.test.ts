import { describe, expect, it } from "vitest";
import type { LiveSessionData } from "../rivian/types.js";
import { LiveBus } from "./live-bus.js";

describe("LiveBus", () => {
  it("remembers the latest charging session per vehicle for new subscribers", () => {
    const bus = new LiveBus();
    expect(bus.latestChargingSession("v1")).toBeNull();

    const session = { soc: { value: 55 } } as unknown as LiveSessionData;
    bus.emitChargingSession("v1", session);
    expect(bus.latestChargingSession("v1")).toBe(session);
    expect(bus.latestChargingSession("v2")).toBeNull();

    bus.emitChargingSession("v1", null);
    expect(bus.latestChargingSession("v1")).toBeNull();
  });
});
