import type { DriveDto } from '@server/api-types';
import { describe, expect, it } from 'vitest';
import { drives as fixtureDrives } from '../../testing/fixtures';
import { unitFormatter } from '../../lib/units';
import {
  bucketEdges,
  efficiencyFactors,
  efficiencyValue,
  overallEfficiency,
  shownFactors,
} from './efficiency';

const imperial = unitFormatter({ distance: 'mi', temperature: 'F' });
const metric = unitFormatter({ distance: 'km', temperature: 'C' });

const START = Date.parse('2026-10-01T15:00:00Z');

/** A finished drive of `km` over `minutes`, using `kwh`. */
function drive(km: number, kwh: number, minutes: number, extra: Partial<DriveDto> = {}): DriveDto {
  return {
    ...fixtureDrives[0]!,
    startedAt: new Date(START).toISOString(),
    endedAt: new Date(START + minutes * 60_000).toISOString(),
    distanceKm: km,
    energyKwh: kwh,
    ...extra,
  };
}

const factor = (fs: ReturnType<typeof efficiencyFactors>, key: string) =>
  fs.find((f) => f.key === key)!;

describe('bucketEdges', () => {
  it('steps evenly across the middle of the values, on round numbers', () => {
    const temps = Array.from({ length: 21 }, (_, i) => 30 + i * 2.5); // 30–80
    expect(bucketEdges(temps)).toEqual([40, 50, 60, 70]);
  });

  it('keeps steps whole even when the values bunch up', () => {
    expect(bucketEdges([81, 82, 82.5, 83, 84])).toEqual([82, 83, 84]);
  });

  it('crosses zero for values either side of it', () => {
    expect(bucketEdges([-60, -30, -5, 0, 5, 30, 60])).toEqual([-40, -20, 0, 20, 40, 60]);
  });

  it('has no edges, so one bucket, with fewer than two values', () => {
    expect(bucketEdges([])).toEqual([]);
    expect(bucketEdges([5])).toEqual([]);
  });
});

describe('efficiencyFactors', () => {
  it('buckets drives by ranges drawn from their own values, in the display unit', () => {
    const fs = efficiencyFactors(
      Array.from({ length: 11 }, (_, i) => drive(30, 10, 30, { outsideTempC: i * 2 })), // 32–68°F
      imperial,
    );
    const t = factor(fs, 'temperature');
    expect(t.buckets.map((b) => b.short)).toEqual(['<40°F', '40–50°F', '50–60°F', '60+°F']);
    expect(t.buckets[0]).toMatchObject({ label: 'Under 40°F', drives: 3, km: 90, kwh: 30 });
    expect(t.buckets.reduce((sum, b) => sum + b.drives, 0)).toBe(11);
  });

  it('takes average speed over the whole drive, and net climb per distance', () => {
    // 80 km in an hour is 49.7 mph; 10 km in 15 minutes, 24.9 mph.
    const fs = efficiencyFactors(
      [
        drive(80, 25, 60, { elevationGainM: 100, elevationLossM: 400 }),
        drive(10, 3, 15, { elevationGainM: 400, elevationLossM: 100 }),
      ],
      imperial,
    );
    const speed = factor(fs, 'speed').buckets;
    expect(speed[0]!.drives).toBe(1);
    expect(speed.at(-1)!.drives).toBe(1);
    const climb = factor(fs, 'elevation');
    expect(climb.buckets[0]!.label).toBe('Under 0 ft/mi');
  });

  it('says "to" in ranges with a negative end, and names the ends of the climb axis', () => {
    const nets = [-600, -300, -50, 0, 50, 300, 600]; // m over 10 km: −60 to 60 m/km
    const fs = efficiencyFactors(
      nets.map((m) =>
        drive(10, 3, 15, { elevationGainM: Math.max(m, 0), elevationLossM: Math.max(-m, 0) }),
      ),
      metric,
    );
    const climb = factor(fs, 'elevation');
    expect(climb.buckets.map((b) => b.short)).toEqual([
      '<−40 m/km',
      '−40 to −20 m/km',
      '−20 to 0 m/km',
      '0–20 m/km',
      '20–40 m/km',
      '40–60 m/km',
      '60+ m/km',
    ]);
    expect(climb.ends).toEqual(['← Downhill', 'Uphill →']);
  });

  it('sorts weather into dry, rain and snow, and leaves drives without it out', () => {
    const w = (code: number) => ({
      minC: 0,
      maxC: 0,
      weatherCode: code,
      windKmh: null,
      windFromDeg: null,
    });
    const fs = efficiencyFactors(
      [
        drive(10, 3, 15, { weather: w(2) }),
        drive(10, 3, 15, { weather: w(63) }),
        drive(10, 3, 15, { weather: w(81) }),
        drive(10, 3, 15, { weather: w(73) }),
        drive(10, 3, 15),
      ],
      metric,
    );
    const c = factor(fs, 'conditions');
    expect(c.buckets.map((b) => [b.label, b.drives])).toEqual([
      ['Dry', 1],
      ['Rain', 2],
      ['Snow', 1],
    ]);
    // Only what was driven in.
    const dry = efficiencyFactors([drive(10, 3, 15, { weather: w(0) })], metric);
    expect(factor(dry, 'conditions').buckets.map((b) => b.label)).toEqual(['Dry']);
  });

  it('leaves out drives under way, too short, or without energy', () => {
    const fs = efficiencyFactors(
      [
        drive(30, 10, 30, { endedAt: null }),
        drive(0.5, 0.2, 2),
        drive(30, 10, 30, { energyKwh: null }),
      ],
      imperial,
    );
    expect(factor(fs, 'length').buckets.every((b) => b.drives === 0)).toBe(true);
    expect(overallEfficiency([drive(30, 10, 30, { endedAt: null })])).toEqual({
      drives: 0,
      km: 0,
      kwh: 0,
    });
    expect(overallEfficiency([drive(30, 10, 30), drive(20, 5, 20)])).toEqual({
      drives: 2,
      km: 50,
      kwh: 15,
    });
  });
});

describe('efficiencyValue', () => {
  it('is mi/kWh in miles and kWh/100 km in kilometres', () => {
    expect(efficiencyValue(100, 20, imperial)).toBeCloseTo(3.107, 3);
    expect(efficiencyValue(100, 20, metric)).toBeCloseTo(20);
    expect(efficiencyValue(100, 0, imperial)).toBeNull();
  });
});

describe('shownFactors', () => {
  const keys = (drives: DriveDto[], weather: 'on' | 'off' | 'none') =>
    shownFactors(efficiencyFactors(drives, imperial), weather).map((f) => f.key);
  const noWeather = [drive(30, 10, 30, { outsideTempC: null, weather: null })];

  it('keeps empty weather charts while lookups may still fill them', () => {
    expect(keys(noWeather, 'on')).toEqual([
      'temperature',
      'speed',
      'elevation',
      'length',
      'conditions',
    ]);
  });

  it('leaves out weather charts no drive has data for once lookups are off', () => {
    expect(keys(noWeather, 'off')).toEqual(['speed', 'elevation', 'length']);
    expect(keys(noWeather, 'none')).toEqual(['speed', 'elevation', 'length']);
  });

  it('keeps the weather drives were looked up for before', () => {
    const before = [...noWeather, drive(30, 10, 30, { outsideTempC: 10 })];
    expect(keys(before, 'off')).toContain('temperature');
  });
});
