import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { DEFAULT_BASEMAP, themedStyle } from "./mapStyle.js";

describe("themedStyle", () => {
  it("is a valid MapLibre style", () => {
    const errors = validateStyleMin(themedStyle());
    expect(errors.map((e) => e.message)).toEqual([]);
  });

  it("uses OpenFreeMap by default and honours overrides", () => {
    const byDefault = themedStyle();
    expect(byDefault.glyphs).toBe(DEFAULT_BASEMAP.glyphsUrl);
    expect(byDefault.sources.basemap).toMatchObject({ type: "vector", url: DEFAULT_BASEMAP.tilesUrl });

    const custom = themedStyle({ tilesUrl: "https://tiles.example/planet", glyphsUrl: "https://tiles.example/{fontstack}/{range}.pbf" });
    expect(custom.sources.basemap).toMatchObject({ url: "https://tiles.example/planet" });
    expect(custom.glyphs).toBe("https://tiles.example/{fontstack}/{range}.pbf");
  });
});
