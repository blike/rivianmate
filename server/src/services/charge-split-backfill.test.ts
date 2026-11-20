import { describe, expect, it } from 'vitest';
import type { ChargeBreakdown } from '../rivian/parallax/domains/energy.js';
import { shareSession } from './charge-split-backfill.js';
import type { ChargeRun } from './charging-time.js';

const t = (iso: string) => Date.parse(iso);
const run = (
  from: string,
  to: string,
  startSoc: number | null,
  endSoc: number | null,
): ChargeRun => ({
  from: t(from),
  to: t(to),
  stretches: [{ from: t(from), to: t(to) }],
  startSoc,
  endSoc,
});
const breakdown = (totalKwh: number, minutes: number, km: number): ChargeBreakdown =>
  ({
    totalKwh,
    packKwh: totalKwh - 0.2,
    thermalKwh: 0.2,
    chargingMinutes: minutes,
    rangeAddedKm: km,
  }) as ChargeBreakdown;

const runs = [
  run('2026-10-01T07:00:00Z', '2026-10-01T09:00:00Z', 40, 60),
  run('2026-10-01T12:00:00Z', '2026-10-01T13:00:00Z', 60, 70),
];
const session = { energyKwh: 30, packKwh: 29, thermalKwh: 1, rangeAddedKm: 150, cost: '9.00' };

describe('shareSession', () => {
  it("gives each charge its own breakdown's totals, and the cost by energy", () => {
    const charges = shareSession(session, runs, [
      { at: t('2026-10-01T08:00:00Z'), b: breakdown(10, 60, 50) },
      { at: t('2026-10-01T09:00:00Z'), b: breakdown(20, 120, 100) },
      { at: t('2026-10-01T13:05:00Z'), b: breakdown(10, 60, 50) },
    ]);
    expect(charges.map((c) => [c.energyKwh, c.rangeAddedKm, c.cost])).toEqual([
      [20, 100, '6.00'],
      [10, 50, '3.00'],
    ]);
    expect(charges.map((c) => c.chargingSeconds)).toEqual([7200, 3600]);
  });

  it('shares the session by battery gained when a charge has no breakdown', () => {
    const charges = shareSession(session, runs, [
      { at: t('2026-10-01T09:00:00Z'), b: breakdown(20, 120, 100) },
    ]);
    expect(charges.map((c) => c.energyKwh)).toEqual([20, 10]);
    expect(charges.map((c) => c.cost)).toEqual(['6.00', '3.00']);
  });

  it('keeps every cent of a cost that does not divide evenly', () => {
    const charges = shareSession({ ...session, cost: '10.00' }, [...runs, runs[1]!], []);
    expect(charges.reduce((sum, c) => sum + Number(c.cost), 0)).toBeCloseTo(10);
  });
});
