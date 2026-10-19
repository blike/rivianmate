import { describe, expect, it } from 'vitest';
import { sinceLabel, statusSentence } from './status';

const now = new Date(2026, 9, 18, 15, 0).getTime();

describe('sinceLabel', () => {
  it('gives a time today, yesterday with a time, and a date before that', () => {
    expect(sinceLabel(new Date(2026, 9, 18, 9, 5).getTime(), now)).toMatch(/^since 9:05/);
    expect(sinceLabel(new Date(2026, 9, 17, 21, 0).getTime(), now)).toMatch(
      /^since yesterday, 9:00/,
    );
    expect(sinceLabel(new Date(2026, 9, 12, 8, 0).getTime(), now)).toBe('since Oct 12');
  });
});

describe('statusSentence', () => {
  it('says where a parked vehicle is and since when', () => {
    const s = statusSentence({
      kind: 'parked',
      place: 'Home',
      since: new Date(2026, 9, 18, 9, 5).getTime(),
      now,
    });
    expect(s.headline).toBe('Parked at Home');
    expect(s.detail).toMatch(/^since 9:05/);
  });

  it('leaves out a place it does not know, and a time in the future', () => {
    const s = statusSentence({ kind: 'asleep', place: null, since: now + 60_000, now });
    expect(s).toEqual({ kind: 'asleep', headline: 'Parked', detail: null });
  });

  it('names the destination and speed while driving', () => {
    const s = statusSentence({
      kind: 'driving',
      place: 'Home',
      since: null,
      destination: 'Costco',
      speed: '54 mph',
      now,
    });
    expect(s.headline).toBe('Driving to Costco');
    expect(s.detail).toBe('54 mph');
  });

  it('names the charger while charging', () => {
    const s = statusSentence({ kind: 'charging', place: 'Rivian', since: null, now });
    expect(s.headline).toBe('Charging at Rivian');
  });
});
