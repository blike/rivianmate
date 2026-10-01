import { describe, expect, it } from "vitest";
import { formatNominatim, geocodeKey } from "./drive-places.js";

describe("formatNominatim", () => {
  it("labels a place by street address and town, keeping the full address", () => {
    expect(
      formatNominatim({
        name: "Sigma Sigma Sigma Sorority",
        display_name: "Sigma Sigma Sigma Sorority, 306, West Willow Street, Normal, McLean County, Illinois, 61761, United States",
        address: { amenity: "Sigma Sigma Sigma Sorority", house_number: "306", road: "West Willow Street", town: "Normal", county: "McLean County", state: "Illinois" },
      }),
    ).toEqual({
      place: "306 West Willow Street, Normal",
      address: "Sigma Sigma Sigma Sorority, 306, West Willow Street, Normal, McLean County, Illinois, 61761, United States",
    });
  });

  it("falls back to the place name or the address's first parts", () => {
    expect(formatNominatim({ name: "Trailhead", display_name: "Trailhead, Somewhere", address: { county: "Inyo County" } })?.place).toBe(
      "Trailhead, Inyo County",
    );
    expect(formatNominatim({ display_name: "A, B, C", address: {} })?.place).toBe("A, B");
  });

  it("returns null when nothing is there", () => {
    expect(formatNominatim({ error: "Unable to geocode" })).toBeNull();
  });
});

describe("geocodeKey", () => {
  it("rounds to ~11 m", () => {
    expect(geocodeKey(33.0714378, -117.2566376)).toBe(geocodeKey(33.07141, -117.25661));
  });
});
