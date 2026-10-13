import { describe, expect, it } from 'vitest';
import {
  closedValue,
  closurePlaceholders,
  closureStatuses,
  lockedValue,
  vehicleBody,
} from './closures';

const v = (value: string) => ({ timeStamp: 't', value });

describe('closures', () => {
  it('maps models to body styles', () => {
    expect(vehicleBody('R1T')).toBe('truck');
    expect(vehicleBody('R1S')).toBe('suv');
    expect(vehicleBody('R2')).toBe('suv');
    expect(vehicleBody(null)).toBeNull();
  });

  it('treats placeholder values as unknown', () => {
    expect(closedValue('undefined')).toBeNull();
    expect(closedValue('signal_not_available')).toBeNull();
    expect(closedValue('open')).toBe(false);
    expect(lockedValue('undefined')).toBeNull();
    expect(lockedValue('unlocked')).toBe(false);
  });

  it('hides truck-only parts on an SUV and unknown readings everywhere', () => {
    const state = {
      doorFrontLeftClosed: v('closed'),
      doorFrontLeftLocked: v('undefined'),
      closureLiftgateClosed: v('closed'),
      closureTailgateClosed: v('open'),
      closureTonneauClosed: v('undefined'),
    };
    const suv = closureStatuses(state, 'R1S').closures.map((c) => c.label);
    expect(suv).toEqual(['Driver door', 'Liftgate']);
    const truck = closureStatuses(state, 'R1T').closures.map((c) => c.label);
    expect(truck).toEqual(['Driver door', 'Tailgate']);
    expect(closureStatuses(state, 'R1S').closures[0]!.locked).toBeNull();
  });

  it('lays out every part for the body style before state loads', () => {
    const suv = closurePlaceholders('R1S').closures.map((c) => c.label);
    expect(suv).toContain('Liftgate');
    expect(suv).not.toContain('Tailgate');
    expect(closurePlaceholders('R1T').windows).toHaveLength(4);
  });

  it('shows the rear drop glass only on an R2', () => {
    const state = { windowRearRightClosed: v('closed'), windowRearGlassClosed: v('open') };
    const r2 = closureStatuses(state, 'R2').windows;
    expect(r2.map((w) => [w.label, w.closed])).toEqual([
      ['Window RR', true],
      ['Rear glass', false],
    ]);
    expect(closureStatuses(state, 'R1S').windows.map((w) => w.label)).toEqual(['Window RR']);
    expect(closurePlaceholders('R2').windows.map((w) => w.label)).toContain('Rear glass');
    expect(closurePlaceholders('R1S').windows).toHaveLength(4);
  });
});
