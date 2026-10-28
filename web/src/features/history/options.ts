import type { HistoryMetric } from '@server/api-types';

export const RANGES = [
  // Every reading where that stays light enough to draw; short averages beyond.
  { label: '7d', title: '7 days', hours: 24 * 7, bucket: 'raw' },
  { label: '30d', title: '30 days', hours: 24 * 30, bucket: '5m' },
  { label: '90d', title: '90 days', hours: 24 * 90, bucket: '15m' },
  { label: '365d', title: '365 days', hours: 24 * 365, bucket: '1h' },
] as const;

type MetricKind = 'percent' | 'distance';

/** Raw values: range in km, odometer in metres. */
export const METRICS: { key: HistoryMetric; label: string; kind: MetricKind; scale?: number }[] = [
  { key: 'battery', label: 'Battery', kind: 'percent' },
  { key: 'range', label: 'Range', kind: 'distance' },
  { key: 'mileage', label: 'Odometer', kind: 'distance', scale: 1 / 1000 },
];
