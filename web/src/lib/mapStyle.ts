import type {
  ExpressionSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";

/**
 * Basemap palette, derived from the app's tokens (index.css): warm
 * near-black land, cool desaturated water, roads as rising warm greys so
 * the vehicle and its route (the yellow accent) stay the brightest things
 * on the map.
 */
export const MAP_THEME = {
  background: "#151514",
  landuse: "#181817",
  park: "#18201a",
  wood: "#172019",
  grass: "#1a1f18",
  sand: "#1f1d17",
  ice: "#1d2124",
  water: "#132029",
  waterLine: "#1c2d3a",
  building: "#232321",
  buildingOutline: "#30302c",
  roadMinor: "#2e2e2a",
  roadSecondary: "#353430",
  roadPrimary: "#43413b",
  roadMotorway: "#56534a",
  roadPath: "#33322e",
  rail: "#34332f",
  boundary: "#4a4840",
  labelPrimary: "#c3c2b7",
  labelSecondary: "#8b8a80",
  labelWater: "#5d7686",
  labelHalo: "#121211",
  accent: "#f5c518",
  accentDim: "#7a6512",
} as const;

export interface BasemapSource {
  /** TileJSON URL for OpenMapTiles-schema vector tiles. */
  tilesUrl: string;
  /** Glyph URL template with {fontstack} and {range}. */
  glyphsUrl: string;
}

/** OpenFreeMap: free OpenMapTiles-schema tiles, no API key required. */
export const DEFAULT_BASEMAP: BasemapSource = {
  tilesUrl: "https://tiles.openfreemap.org/planet",
  glyphsUrl: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
};

const FONT_REGULAR = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];
const FONT_ITALIC = ["Noto Sans Italic"];

const SOURCE = "basemap";

/** Line width that scales smoothly with zoom (exponential, like real roads). */
function width(stops: [number, number][]): ExpressionSpecification {
  return ["interpolate", ["exponential", 1.5], ["zoom"], ...stops.flat()] as ExpressionSpecification;
}

const name: ExpressionSpecification = ["coalesce", ["get", "name:latin"], ["get", "name"]];

function roadLayer(
  id: string,
  classes: string[],
  color: string,
  stops: [number, number][],
  minzoom: number,
): LayerSpecification {
  return {
    id,
    type: "line",
    source: SOURCE,
    "source-layer": "transportation",
    minzoom,
    filter: ["all", ["in", ["get", "class"], ["literal", classes]], ["!=", ["get", "brunnel"], "tunnel"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": color, "line-width": width(stops) },
  };
}

/** The app's themed basemap over OpenMapTiles-schema vector tiles. */
export function themedStyle(basemap: BasemapSource = DEFAULT_BASEMAP): StyleSpecification {
  const t = MAP_THEME;
  return {
    version: 8,
    name: "RivianMate Night",
    glyphs: basemap.glyphsUrl,
    sources: {
      [SOURCE]: { type: "vector", url: basemap.tilesUrl },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": t.background } },
      {
        id: "landuse",
        type: "fill",
        source: SOURCE,
        "source-layer": "landuse",
        filter: ["in", ["get", "class"], ["literal", ["residential", "suburb", "neighbourhood", "commercial", "industrial", "retail"]]],
        paint: { "fill-color": t.landuse, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 12, 1] },
      },
      {
        id: "landcover",
        type: "fill",
        source: SOURCE,
        "source-layer": "landcover",
        paint: {
          "fill-color": [
            "match",
            ["get", "class"],
            "wood", t.wood,
            "forest", t.wood,
            "grass", t.grass,
            "farmland", t.grass,
            "sand", t.sand,
            "ice", t.ice,
            t.grass,
          ],
          "fill-opacity": 0.9,
        },
      },
      {
        id: "park",
        type: "fill",
        source: SOURCE,
        "source-layer": "park",
        paint: { "fill-color": t.park },
      },
      {
        id: "water",
        type: "fill",
        source: SOURCE,
        "source-layer": "water",
        filter: ["!=", ["get", "brunnel"], "tunnel"],
        paint: { "fill-color": t.water },
      },
      {
        id: "waterway",
        type: "line",
        source: SOURCE,
        "source-layer": "waterway",
        filter: ["!=", ["get", "brunnel"], "tunnel"],
        paint: {
          "line-color": t.waterLine,
          "line-width": width([[8, 0.5], [14, 2], [18, 6]]),
        },
      },
      {
        id: "building",
        type: "fill",
        source: SOURCE,
        "source-layer": "building",
        minzoom: 13,
        paint: {
          "fill-color": t.building,
          "fill-outline-color": t.buildingOutline,
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 15, 1],
        },
      },
      {
        id: "road-path",
        type: "line",
        source: SOURCE,
        "source-layer": "transportation",
        minzoom: 14,
        filter: ["in", ["get", "class"], ["literal", ["path", "track"]]],
        layout: { "line-cap": "round" },
        paint: {
          "line-color": t.roadPath,
          "line-width": width([[14, 0.5], [18, 1.5]]),
          "line-dasharray": [2, 2],
        },
      },
      roadLayer("road-minor", ["minor", "service"], t.roadMinor, [[12, 0.5], [14, 1.5], [18, 12]], 12),
      roadLayer("road-secondary", ["secondary", "tertiary"], t.roadSecondary, [[8, 0.5], [12, 1.2], [18, 18]], 8),
      roadLayer("road-primary", ["primary", "trunk"], t.roadPrimary, [[6, 0.5], [10, 1.4], [18, 22]], 6),
      roadLayer("road-motorway", ["motorway"], t.roadMotorway, [[4, 0.5], [9, 1.6], [18, 26]], 4),
      {
        id: "rail",
        type: "line",
        source: SOURCE,
        "source-layer": "transportation",
        minzoom: 11,
        filter: ["==", ["get", "class"], "rail"],
        paint: {
          "line-color": t.rail,
          "line-width": width([[11, 0.6], [18, 2]]),
          "line-dasharray": [3, 3],
        },
      },
      {
        id: "boundary",
        type: "line",
        source: SOURCE,
        "source-layer": "boundary",
        filter: ["all", ["<=", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
        paint: {
          "line-color": t.boundary,
          "line-width": width([[3, 0.5], [10, 1.5]]),
          "line-dasharray": [4, 3],
        },
      },
      // symbol-placement can't vary per feature, so lakes and rivers get a layer each.
      {
        id: "water-name-point",
        type: "symbol",
        source: SOURCE,
        "source-layer": "water_name",
        filter: ["==", ["geometry-type"], "Point"],
        layout: { "text-field": name, "text-font": FONT_ITALIC, "text-size": 12 },
        paint: { "text-color": t.labelWater, "text-halo-color": t.labelHalo, "text-halo-width": 1.2 },
      },
      {
        id: "water-name-line",
        type: "symbol",
        source: SOURCE,
        "source-layer": "water_name",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: {
          "text-field": name,
          "text-font": FONT_ITALIC,
          "text-size": 12,
          "symbol-placement": "line",
        },
        paint: { "text-color": t.labelWater, "text-halo-color": t.labelHalo, "text-halo-width": 1.2 },
      },
      {
        id: "road-name",
        type: "symbol",
        source: SOURCE,
        "source-layer": "transportation_name",
        minzoom: 13,
        layout: {
          "text-field": name,
          "text-font": FONT_REGULAR,
          "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 18, 13],
          "symbol-placement": "line",
          "text-letter-spacing": 0.02,
        },
        paint: { "text-color": t.labelSecondary, "text-halo-color": t.labelHalo, "text-halo-width": 1.4 },
      },
      {
        id: "place-minor",
        type: "symbol",
        source: SOURCE,
        "source-layer": "place",
        minzoom: 11,
        filter: ["in", ["get", "class"], ["literal", ["village", "hamlet", "suburb", "neighbourhood", "quarter"]]],
        layout: {
          "text-field": name,
          "text-font": FONT_REGULAR,
          "text-size": ["interpolate", ["linear"], ["zoom"], 11, 11, 16, 14],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.08,
        },
        paint: { "text-color": t.labelSecondary, "text-halo-color": t.labelHalo, "text-halo-width": 1.4 },
      },
      {
        id: "place-major",
        type: "symbol",
        source: SOURCE,
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
        layout: {
          "text-field": name,
          "text-font": FONT_BOLD,
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 12, 17],
        },
        paint: { "text-color": t.labelPrimary, "text-halo-color": t.labelHalo, "text-halo-width": 1.6 },
      },
    ],
  };
}
