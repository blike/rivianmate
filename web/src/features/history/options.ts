import type { HistoryMetric } from '@server/api-types';

export const RANGES = [
  // Every reading where that stays light enough to draw; short averages beyond.
  { label: '24h', title: '24 hours', hours: 24, bucket: 'raw' },
  { label: '7d', title: '7 days', hours: 24 * 7, bucket: 'raw' },
  { label: '14d', title: '14 days', hours: 24 * 14, bucket: '5m' },
  { label: '30d', title: '30 days', hours: 24 * 30, bucket: '5m' },
  { label: '90d', title: '90 days', hours: 24 * 90, bucket: '15m' },
  { label: '6m', title: '6 months', hours: 24 * 182, bucket: '1h' },
  { label: '12m', title: '12 months', hours: 24 * 365, bucket: '1h' },
] as const;

export type Range = (typeof RANGES)[number];
export type RangeLabel = Range['label'];

/** What the page opens on. */
export const DEFAULT_RANGE: RangeLabel = '7d';

export const rangeOf = (label: RangeLabel): Range =>
  RANGES.find((r) => r.label === label) ?? RANGES[1];

/** The periods either side of one in the list: the likeliest to be picked next, so loaded ahead. */
export function neighbours(range: Range): Range[] {
  const i = RANGES.findIndex((r) => r.label === range.label);
  return [RANGES[i - 1], RANGES[i + 1]].filter((r): r is Range => r != null);
}

/** How long another period loaded ahead stays fresh enough not to load again. */
export const PREFETCH_FRESH_MS = 5 * 60_000;

type MetricKind = 'percent' | 'distance';

/** Raw values: range in km, odometer in metres. */
export const METRICS: { key: HistoryMetric; label: string; kind: MetricKind; scale?: number }[] = [
  { key: 'battery', label: 'Battery', kind: 'percent' },
  { key: 'range', label: 'Range', kind: 'distance' },
  { key: 'mileage', label: 'Odometer', kind: 'distance', scale: 1 / 1000 },
];
