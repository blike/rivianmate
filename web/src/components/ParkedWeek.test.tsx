import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parkedNights, recordedNights } from '../lib/insights';
import { ParkedWeek } from './ParkedWeek';

/** A night as RivianMate recorded it: the 24-hour window and when Rivian sent it. */
const record = (day: number, kwh: number) => ({
  at: new Date(2026, 9, day, 0, 30).toISOString(),
  minutes: 1440,
  kwh,
  rangeKm: 5.2,
  uses: { climate: 0.2, system: 0.8, gearGuard: 0, outlets: 0 },
});

/** The morning of the 8th: the week ends here, whatever day the tests run on. */
const today = new Date(2026, 9, 8, 9, 0);

describe('ParkedWeek', () => {
  it('draws one slot per night of the week, with the totals above them', () => {
    const html = renderToStaticMarkup(
      <ParkedWeek nights={recordedNights([record(8, 1.1)], 7, today)} />,
    );
    expect(html.match(/data-night=/g)).toHaveLength(7);
    expect(html.match(/role="img"/g)).toHaveLength(7);
    // The number comes first, so the shape is read against it.
    expect(html).toContain('1.1 kWh over 1 night');
    expect(html.indexOf('1.1 kWh over 1 night')).toBeLessThan(html.indexOf('role="img"'));
  });

  it('fills a slot for every night with a record, and leaves the rest empty', () => {
    const html = renderToStaticMarkup(
      <ParkedWeek nights={recordedNights([record(6, 1.1), record(8, 0.4)], 7, today)} />,
    );
    expect(html.match(/data-night=/g)).toHaveLength(7);
    expect(html).toContain('1.5 kWh over 2 nights');
    // Five nights with nothing recorded stay as empty tracks.
    expect(html.match(/bg-\(--surface-3\)/g)).toHaveLength(5);
  });

  it('names each night and its uses for a screen reader, and says where nothing was reported', () => {
    const html = renderToStaticMarkup(
      <ParkedWeek nights={recordedNights([record(8, 1.1)], 7, today)} />,
    );
    expect(html).toMatch(/aria-label="[^"]*: 1\.1 kWh used while parked over the last 24 hours/);
    expect(html).toMatch(/aria-label="[^"]*: no parked energy reported"/);
    // One bar with a record, six nights drawn empty.
    expect(html.match(/bg-\(--surface-3\)/g)).toHaveLength(6);
    expect(html).toContain('another client swaps the two');
  });

  it('draws nothing when there is no night to draw', () => {
    expect(renderToStaticMarkup(<ParkedWeek nights={[]} />)).toBe('');
    expect(renderToStaticMarkup(<ParkedWeek nights={parkedNights([], '')} />)).toBe('');
    expect(renderToStaticMarkup(<ParkedWeek nights={recordedNights([], 0, today)} />)).toBe('');
  });
});
