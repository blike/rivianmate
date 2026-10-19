import { describe, expect, it } from 'vitest';
import { capacityEstimates, drainSnapshots, parkedLoss, phantomDrain } from './health.js';

const at = (h: number) => new Date(Date.UTC(2026, 8, 1, 0) + h * 3600_000);
const snap = (h: number, battery: number, mileage = 1000, charger = 'chrgr_sts_not_connected') => ({
  ts: at(h),
  batteryLevel: battery,
  mileageM: mileage,
  chargerStatus: charger,
});

describe('parkedLoss', () => {
  const span = (h0: number, h1: number | null, l0: number | null, l1: number | null) => ({
    start: at(h0),
    end: h1 == null ? null : at(h1),
    startLevel: l0,
    endLevel: l1,
  });
  const readings: [number, number][] = [];
  const levelAt = (t: Date) => readings.findLast(([h]) => at(h) <= t)?.[1] ?? null;

  it('measures each parked stretch from one drive or charge to the next', () => {
    readings.splice(0, Infinity, [0, 80], [13.5, 79]);
    const r = parkedLoss(
      [
        span(1, 2, 79.8, 75), // drive
        span(4, 5, 74.5, 72), // drive
        span(6, 10, 71.8, 85), // charge
        span(12, 13, 84.6, 80), // drive
      ],
      at(0),
      at(14),
      levelAt,
    );
    // 80 → 79.8, 75 → 74.5, 72 → 71.8, 85 → 84.6, then 80 → the last reading, 79.
    expect(r.lossPct).toBeCloseTo(0.2 + 0.5 + 0.2 + 0.4 + 1);
    expect(r.parkedHours).toBeCloseTo(1 + 2 + 1 + 2 + 1);
  });

  it('ignores a dip in the readings that recovers once the vehicle wakes', () => {
    // Parked at 60 %, read 59.4 % asleep, and the next drive started at 59.9 %.
    readings.splice(0, Infinity, [0, 60], [5, 59.4], [9, 59.9]);
    const r = parkedLoss([span(0, 1, 60, 60), span(9, 10, 59.9, 59)], at(1), at(10), levelAt);
    expect(r.lossPct).toBeCloseTo(0.1);
    expect(r.parkedHours).toBeCloseTo(8);
  });

  it('falls back to the readings for spans without levels', () => {
    readings.splice(0, Infinity, [0, 80], [3, 79], [5, 90]);
    const r = parkedLoss([span(3, 5, null, null)], at(0), at(6), levelAt);
    expect(r.lossPct).toBeCloseTo(1);
    expect(r.parkedHours).toBeCloseTo(4);
  });

  it('is nothing with no parked time', () => {
    readings.splice(0, Infinity, [0, 80]);
    expect(parkedLoss([span(0, null, 80, null)], at(0), at(4), levelAt)).toEqual({
      lossPct: 0,
      parkedHours: 0,
    });
  });
});

describe('phantomDrain', () => {
  it('measures loss while parked and normalizes to per day', () => {
    const r = phantomDrain([snap(0, 80), snap(4, 79.5), snap(8, 79), snap(12, 78.5)]);
    expect(r.days).toHaveLength(1);
    expect(r.days[0]!.lossPct).toBeCloseTo(1.5);
    expect(r.days[0]!.parkedHours).toBeCloseTo(12);
    expect(r.avgPctPerDay).toBeCloseTo(3);
  });

  it('ignores driving, charging, being plugged in and long gaps', () => {
    const r = phantomDrain([
      snap(0, 80),
      snap(1, 75, 5000), // drove
      snap(2, 76, 5000, 'chrgr_sts_connected_charging'), // charging
      snap(3, 90, 5000, 'chrgr_sts_connected_no_chrg'), // plugged in
      snap(4, 90, 5000),
      snap(20, 85, 5000), // 16 h gap: blind spot
      snap(22, 84.8, 5000), // valid: 0.2 % in 2 h
    ]);
    expect(r.avgPctPerDay).toBeNull(); // only 2 h of parked data
    expect(r.days).toEqual([]);
  });

  it("ignores time in drive or reverse even if the odometer hasn't caught up", () => {
    const r = phantomDrain([
      snap(0, 80),
      { ...snap(0.5, 79), gear: 'drive' },
      snap(1, 78),
      snap(5, 77.9),
      snap(9, 77.8),
    ]);
    expect(r.days[0]!.lossPct).toBeCloseTo(0.2);
    expect(r.days[0]!.parkedHours).toBeCloseTo(8);
  });

  it('nets out a reading that dips on wake and recovers', () => {
    // From a real vehicle: a 0.6 % blip once counted as ~30 %/day.
    const r = phantomDrain([
      snap(0, 56.9),
      snap(0.5, 56.3),
      snap(0.55, 56.7),
      snap(4, 56.7),
      snap(8, 56.7),
    ]);
    expect(r.days[0]!.lossPct).toBeCloseTo(0.2);
    expect(r.avgPctPerDay).toBeCloseTo(0.6);
  });

  it('leaves out days with too little parked time but keeps them in the average', () => {
    const r = phantomDrain([snap(18, 80), snap(24, 79), snap(26, 78.8)]);
    expect(r.days.map((d) => d.day)).toEqual(['2026-09-01']);
    expect(r.avgPctPerDay).toBeCloseTo((1.2 / 8) * 24);
  });

  it('splits a stretch across days by time, in the given time zone', () => {
    const r = phantomDrain([snap(16, 80), snap(22, 79), snap(28, 78), snap(34, 77)]);
    expect(r.days.map((d) => d.day)).toEqual(['2026-09-01', '2026-09-02']);
    // 16:00 UTC is 09:00 in Los Angeles, so all 18 h land on Sep 1.
    const la = phantomDrain(
      [snap(16, 80), snap(22, 79), snap(28, 78), snap(34, 77)],
      'America/Los_Angeles',
    );
    expect(la.days.map((d) => d.day)).toEqual(['2026-09-01']);
  });
});

describe('drainSnapshots', () => {
  const t = (hhmm: string) => Date.parse(`2026-10-12T${hhmm}:00Z`);
  const reading = (at: string, level: [number, string], mileage: [number, string]) => ({
    at: t(at),
    batteryLevel: { value: level[0], at: t(level[1]) },
    mileage: { value: mileage[0], at: t(mileage[1]) },
    chargerStatus: 'chrgr_sts_not_connected',
    gear: 'park',
  });

  it("drops a level from before a late drive's mileage, until the level after it arrives", () => {
    // Real: a drive delivered late, its mileage stamped 15:09 and level 15:12.
    const rows = drainSnapshots([
      reading('14:50', [63.1, '14:48'], [7_582_257, '14:46']),
      reading('15:09', [63.1, '14:48'], [7_586_172, '15:09']),
      reading('15:12', [61.8, '15:12'], [7_586_172, '15:09']),
      reading('18:00', [61.8, '15:12'], [7_586_172, '15:09']), // a heartbeat
      reading('21:30', [61.6, '21:30'], [7_586_172, '15:09']),
    ]);
    expect(rows.map((r) => r.batteryLevel)).toEqual([63.1, null, 61.8, 61.8, 61.6]);
    expect(phantomDrain(rows).days[0]?.lossPct).toBeCloseTo(0.2);
  });

  it('keeps a level that held through parking when no new one followed soon', () => {
    const rows = drainSnapshots([
      reading('15:00', [70, '14:55'], [1000, '14:58']),
      reading('16:00', [70, '14:55'], [1000, '14:58']),
      reading('20:00', [69.5, '20:00'], [1000, '14:58']),
    ]);
    expect(rows.map((r) => r.batteryLevel)).toEqual([70, 70, 69.5]);
  });
});

describe('capacityEstimates', () => {
  it('estimates capacity from energy and SoC gained, skipping small sessions', () => {
    const r = capacityEstimates([
      { id: 1, startedAt: at(0), startSoc: 20, endSoc: 80, energyKwh: 78 },
      { id: 2, startedAt: at(24), startSoc: 70, endSoc: 80, energyKwh: 13 },
      { id: 3, startedAt: at(48), startSoc: 30, endSoc: 70, energyKwh: null },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.estimatedKwh).toBeCloseTo(130);
    expect(r[0]!.socGain).toBe(60);
  });
});
