import { describe, expect, it } from "vitest";
import { unitFormatter } from "./units.js";

describe("unitFormatter", () => {
  it("formats imperial", () => {
    const u = unitFormatter({ distance: "mi", temperature: "F" });
    expect(u.formatDistance(100)).toBe("62 mi");
    expect(u.formatSpeed(100)).toBe("62 mph");
    expect(u.formatTemperature(21)).toBe("70 °F");
    expect(u.formatDistance(null)).toBe("—");
    expect(u.formatElevation(100)).toBe("328 ft");
    expect(u.formatPressure(3.2)).toBe("46 psi");
    expect(u.formatEfficiency(40, 10)).toBe("2.49 mi/kWh");
    expect(u.formatEfficiency(40, 0)).toBe("—");
  });

  it("formats metric", () => {
    const u = unitFormatter({ distance: "km", temperature: "C" });
    expect(u.formatDistance(100)).toBe("100 km");
    expect(u.formatSpeed(90)).toBe("90 km/h");
    expect(u.formatTemperature(21.4, 1)).toBe("21.4 °C");
    expect(u.formatElevation(100)).toBe("100 m");
    expect(u.formatPressure(3.2)).toBe("3.20 bar");
    expect(u.formatEfficiency(40, 10)).toBe("25.0 kWh/100 km");
  });
});
