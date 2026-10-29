import { describe, expect, it } from 'vitest';
import { withFix } from './hooks';

const fix = (ts: string, lat = 33) => ({ ts, lat, lon: -117 });

describe('withFix', () => {
  it('keeps every new fix in order, each as it arrives', () => {
    const one = withFix([], fix('2026-10-28T21:40:00Z'));
    const two = withFix(one, fix('2026-10-28T21:40:01Z', 33.0001));
    expect(two).toEqual([fix('2026-10-28T21:40:00Z'), fix('2026-10-28T21:40:01Z', 33.0001)]);
  });

  it("doesn't add a fix again when another reading changes the state", () => {
    const fixes = [fix('2026-10-28T21:40:00Z')];
    expect(withFix(fixes, fix('2026-10-28T21:40:00Z'))).toBe(fixes);
  });

  it('lets go of fixes from over ten minutes before the newest', () => {
    expect(
      withFix(
        [fix('2026-10-28T21:29:00Z'), fix('2026-10-28T21:35:00Z')],
        fix('2026-10-28T21:40:00Z'),
      ),
    ).toEqual([fix('2026-10-28T21:35:00Z'), fix('2026-10-28T21:40:00Z')]);
  });
});
