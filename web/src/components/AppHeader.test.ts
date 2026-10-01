import { describe, expect, it } from "vitest";
import { currentNavItem } from "./AppHeader.js";

describe("currentNavItem", () => {
  it("labels the menu button with the current page", () => {
    expect(currentNavItem("/")?.label).toBe("Dashboard");
    expect(currentNavItem("/charging")?.label).toBe("Charging");
    expect(currentNavItem("/charging/42")?.label).toBe("Charging");
    expect(currentNavItem("/chargingx")).toBeUndefined();
  });
});
