import { describe, expect, it } from "vitest";
import { unitFormatter } from "./units.js";

describe("unitFormatter", () => {
  it("formats imperial", () => {
    const u = unitFormatter({ distance: "mi", temperature: "F" });
    expect(u.formatDistance(100)).toBe("62 mi");
    expect(u.formatSpeed(100)).toBe("62 mph");
    expect(u.formatTemperature(21)).toBe("70 °F");
    expect(u.formatDistance(null)).toBe("—");
  });

  it("formats metric", () => {
    const u = unitFormatter({ distance: "km", temperature: "C" });
    expect(u.formatDistance(100)).toBe("100 km");
    expect(u.formatSpeed(90)).toBe("90 km/h");
    expect(u.formatTemperature(21.4, 1)).toBe("21.4 °C");
  });
});
