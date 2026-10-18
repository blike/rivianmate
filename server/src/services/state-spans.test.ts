import { describe, expect, it } from 'vitest';
import { type VehicleActivity, stateSpans } from './state-spans.js';

const H = 3600_000;
const at = (h: number) => new Date(Date.UTC(2026, 9, 1) + h * H);
const change = (h: number, state: VehicleActivity) => ({ ts: at(h), state });

describe('stateSpans', () => {
  it('runs each state until the next change', () => {
    const spans = stateSpans(
      [change(1, 'awake'), change(2, 'driving'), change(3, 'awake'), change(4, 'asleep')],
      at(0),
      at(24),
    );
    expect(spans).toEqual([
      { state: 'awake', from: at(1), to: at(2) },
      { state: 'driving', from: at(2), to: at(3) },
      { state: 'awake', from: at(3), to: at(4) },
      { state: 'asleep', from: at(4), to: at(24) },
    ]);
  });

  it('opens in the state set before the window and clips to it', () => {
    const spans = stateSpans([change(-5, 'asleep'), change(20, 'awake')], at(0), at(24));
    expect(spans).toEqual([
      { state: 'asleep', from: at(0), to: at(20) },
      { state: 'awake', from: at(20), to: at(24) },
    ]);
  });

  it('merges repeats and leaves out changes past the window', () => {
    const spans = stateSpans(
      [change(1, 'charging'), change(2, 'charging'), change(30, 'awake')],
      at(0),
      at(24),
    );
    expect(spans).toEqual([{ state: 'charging', from: at(1), to: at(24) }]);
  });
});
