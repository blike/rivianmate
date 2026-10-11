import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { BASEMAP, themedStyle } from './mapStyle';

describe('themedStyle', () => {
  it('is a valid MapLibre style', () => {
    const errors = validateStyleMin(themedStyle());
    expect(errors.map((e) => e.message)).toEqual([]);
  });

  it('uses OpenFreeMap', () => {
    const style = themedStyle();
    expect(style.glyphs).toBe(BASEMAP.glyphsUrl);
    expect(style.sources.basemap).toMatchObject({ type: 'vector', url: BASEMAP.tilesUrl });
  });
});
