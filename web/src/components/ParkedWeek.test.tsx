import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parkedNights } from '../lib/insights';
import { ParkedWeek } from './ParkedWeek';

/** A night's source, as the panel hands it over: Rivian's window. */
const window = (minutes: number, kwh: number) => ({
  minutes,
  kwh,
  rangeKm: 5.2,
  uses: { climate: 0.2, system: 0.8, gearGuard: 0, outlets: 0 },
});

const at = new Date(2026, 9, 8, 14, 0).toISOString();

describe('ParkedWeek', () => {
  it('draws one slot per night of the week, with the totals above them', () => {
    const html = renderToStaticMarkup(<ParkedWeek nights={parkedNights([window(480, 1.1)], at)} />);
    expect(html.match(/data-night=/g)).toHaveLength(7);
    expect(html.match(/role="img"/g)).toHaveLength(7);
    // The number comes first, so the shape is read against it.
    expect(html).toContain('1.1 kWh over 1 night');
    expect(html.indexOf('1.1 kWh over 1 night')).toBeLessThan(html.indexOf('role="img"'));
  });

  it('names each night and its uses for a screen reader, and says where nothing was reported', () => {
    const html = renderToStaticMarkup(<ParkedWeek nights={parkedNights([window(480, 1.1)], at)} />);
    expect(html).toMatch(/aria-label="[^"]*: 1\.1 kWh used while parked over the last 8 hours/);
    expect(html).toMatch(/aria-label="[^"]*: no parked energy reported"/);
    // One bar with a window, six nights drawn empty.
    expect(html.match(/bg-\(--surface-3\)/g)).toHaveLength(6);
    expect(html).toContain('another client swaps the two');
  });

  it('draws nothing when the source reported no windows', () => {
    expect(renderToStaticMarkup(<ParkedWeek nights={[]} />)).toBe('');
    expect(renderToStaticMarkup(<ParkedWeek nights={parkedNights([], '')} />)).toBe('');
  });
});
