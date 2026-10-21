import type { DriveDto } from '@server/api-types';
import type { unitFormatter } from '../../lib/units';

type Units = ReturnType<typeof unitFormatter>;

/** Drives shorter than this say little about efficiency; the battery reads in whole percents. */
const MIN_KM = 1;
/** Fewer drives than this in a bucket, and it's shown as a rough figure. */
export const FEW_DRIVES = 3;

export interface EfficiencyBucket {
  /** In full, unit and all: "20–35°F". */
  label: string;
  /** Under its bar: "20–35°F". */
  short: string;
  drives: number;
  km: number;
  kwh: number;
}

export interface EfficiencyFactor {
  key: string;
  title: string;
  /** Words for the low and high ends of the axis, where the direction needs saying. */
  ends?: [string, string];
  buckets: EfficiencyBucket[];
}

/** Drives that say something about efficiency: finished, long enough, and with energy. */
const usable = (d: DriveDto) =>
  d.endedAt != null && d.distanceKm != null && d.distanceKm >= MIN_KM && d.energyKwh != null;

interface FactorSpec {
  key: string;
  title: string;
  /** The drive's value in display units; null leaves it out of this factor. */
  value: (d: DriveDto, km: number) => number | null;
  unit: string;
  ends?: [string, string];
  /** Categories in place of ranges, by value 0, 1, 2…; only those driven in are shown. */
  names?: string[];
}

/** About this many ranges between the open-ended ones at either end. */
const TARGET_RANGES = 4;

/** The round step (1, 2 or 5 × a power of ten, and at least 1) nearest to `raw`. */
function niceStep(raw: number): number {
  if (!(raw > 1)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1.5 ? 1 : f <= 3.5 ? 2 : f <= 7.5 ? 5 : 10) * pow;
}

/**
 * Upper edges for the buckets, from the drives' own values: round steps
 * across the middle 90% of them, so each end's open bucket holds the
 * outliers. Empty when they're all much the same.
 */
export function bucketEdges(values: readonly number[]): number[] {
  if (values.length < 2) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.round(q * (sorted.length - 1))]!;
  const lo = at(0.05);
  const hi = at(0.95);
  const step = niceStep((hi - lo) / TARGET_RANGES);
  // Above the low end, so the open bucket below the first edge holds something.
  const first = Math.floor(lo / step) * step + step;
  const edges: number[] = [];
  for (let e = first; e <= hi && edges.length <= TARGET_RANGES + 1; e += step) edges.push(e);
  return edges;
}

/**
 * Each bucket's range with its unit: "Under 20°F", "20–35°F", "80+°F";
 * `short` puts "<" for "Under", for under the bars.
 */
function rangeLabels(edges: number[], unit: string, short = false): string[] {
  const after = unit ? `${unit.startsWith('°') ? '' : ' '}${unit}` : '';
  const n = (x: number) => (x < 0 ? `−${-x}` : `${x}`);
  if (!edges.length) return [short ? 'All' : 'All drives'];
  return [
    `${short ? '<' : 'Under '}${n(edges[0]!)}${after}`,
    // "–" reads as a minus beside a negative number, so those say "to".
    ...edges
      .slice(1)
      .map((e, i) => `${n(edges[i]!)}${edges[i]! < 0 ? ' to ' : '–'}${n(e)}${after}`),
    `${n(edges.at(-1)!)}+${after}`,
  ];
}

/** WMO codes: drizzle, rain and showers are wet; snow is its own; the rest is dry. */
function condition(code: number): number {
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 2;
  if (code >= 51) return 1;
  return 0;
}

function factorSpecs(u: Units): FactorSpec[] {
  return [
    {
      key: 'temperature',
      title: 'Outside temperature',
      value: (d) => u.temperature(d.outsideTempC),
      unit: u.temperatureUnit,
    },
    {
      key: 'speed',
      title: 'Average speed',
      // Over the whole drive, stops included.
      value: (d, km) => {
        const hours = d.endedAt ? (Date.parse(d.endedAt) - Date.parse(d.startedAt)) / 3600_000 : 0;
        return hours > 0 ? u.distance(km / hours) : null;
      },
      unit: u.speedUnit,
    },
    {
      key: 'elevation',
      title: 'Net climb',
      // Net climb per distance: negative is downhill.
      value: (d, km) =>
        d.elevationGainM == null || d.elevationLossM == null
          ? null
          : u.elevation(d.elevationGainM - d.elevationLossM)! / u.distance(km)!,
      unit: `${u.elevationUnit}/${u.distanceUnit}`,
      ends: ['← Downhill', 'Uphill →'],
    },
    {
      key: 'length',
      title: 'Drive length',
      value: (_, km) => u.distance(km),
      unit: u.distanceUnit,
    },
    {
      key: 'conditions',
      title: 'Conditions',
      value: (d) => (d.weather?.weatherCode == null ? null : condition(d.weather.weatherCode)),
      unit: '',
      names: ['Dry', 'Rain', 'Snow'],
    },
  ];
}

/**
 * Finished drives' distance and energy, bucketed by what they were driven
 * in: temperature, speed, climb, length and weather. Ranges follow the
 * drives in the period.
 */
export function efficiencyFactors(drives: readonly DriveDto[], u: Units): EfficiencyFactor[] {
  const counted = drives.filter(usable);
  return factorSpecs(u).map((spec) => {
    const values = counted.flatMap((d) => {
      const v = spec.value(d, d.distanceKm!);
      return v == null || !Number.isFinite(v) ? [] : [{ d, v }];
    });
    const edges = spec.names
      ? spec.names.slice(1).map((_, i) => i + 0.5)
      : bucketEdges(values.map((x) => x.v));
    const labels = spec.names ?? rangeLabels(edges, spec.unit);
    const shorts = spec.names ?? rangeLabels(edges, spec.unit, true);
    const buckets = labels.map((label, i) => ({
      label,
      short: shorts[i]!,
      drives: 0,
      km: 0,
      kwh: 0,
    }));
    for (const { d, v } of values) {
      const i = edges.findIndex((e) => v < e);
      const b = buckets[i < 0 ? buckets.length - 1 : i]!;
      b.drives++;
      b.km += d.distanceKm!;
      b.kwh += d.energyKwh!;
    }
    return {
      key: spec.key,
      title: spec.title,
      ends: spec.ends,
      buckets: spec.names ? buckets.filter((b) => b.drives > 0) : buckets,
    };
  });
}

/**
 * Weather lookups for the drives: on, turned off in Settings, or none
 * (TeslaMate's drives, whose temperatures come from the car).
 */
export type WeatherLookups = 'on' | 'off' | 'none';

const WEATHER_FACTORS = new Set(['temperature', 'conditions']);

/** Whether a factor's values come from weather lookups. */
export const isWeatherFactor = (key: string) => WEATHER_FACTORS.has(key);

/**
 * The factors worth a chart: a weather factor no drive has data for is left
 * out, unless lookups are on and may still fill it in.
 */
export function shownFactors(
  factors: readonly EfficiencyFactor[],
  weather: WeatherLookups,
): EfficiencyFactor[] {
  return factors.filter(
    (f) => !isWeatherFactor(f.key) || weather === 'on' || f.buckets.some((b) => b.drives > 0),
  );
}

/** Drives, distance and energy over every usable drive, for the average. */
export function overallEfficiency(drives: readonly DriveDto[]): {
  drives: number;
  km: number;
  kwh: number;
} {
  const counted = drives.filter(usable);
  return {
    drives: counted.length,
    km: counted.reduce((sum, d) => sum + d.distanceKm!, 0),
    kwh: counted.reduce((sum, d) => sum + d.energyKwh!, 0),
  };
}

/**
 * Efficiency as the units quote it: mi/kWh (higher is better), or
 * kWh/100 km (lower is better); null without energy to divide by.
 */
export function efficiencyValue(km: number, kwh: number, u: Units): number | null {
  if (!(km > 0) || !(kwh > 0)) return null;
  return u.distanceUnit === 'mi' ? u.distance(km)! / kwh : (kwh / km) * 100;
}
