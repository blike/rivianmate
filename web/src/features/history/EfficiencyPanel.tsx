import { useMemo, useState } from 'react';
import type { DriveDto } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { ContentFrame } from '../../components/LoadingState';
import { fmt } from '../../lib/state';
import {
  type EfficiencyBucket,
  type EfficiencyFactor,
  FEW_DRIVES,
  efficiencyFactors,
  efficiencyValue,
  overallEfficiency,
} from './efficiency';

const CHART_HEIGHT = 144;

/**
 * Efficiency by what the drives were driven in, one small chart per factor
 * on a shared scale, with the period's average across them all.
 */
export function EfficiencyPanel(props: {
  drives: DriveDto[] | undefined;
  loading: boolean;
  /** Whether drives get weather lookups; TeslaMate's don't, so Conditions is left out. */
  weather: boolean;
}) {
  const u = useUnits();
  const miles = u.distanceUnit === 'mi';
  const unit = miles ? 'mi/kWh' : 'kWh/100 km';
  const digits = miles ? 2 : 1;

  const factors = useMemo(
    () =>
      efficiencyFactors(props.drives ?? [], u).filter(
        (f) => props.weather || f.key !== 'conditions',
      ),
    [props.drives, u, props.weather],
  );
  // Without Conditions, the average spans a row (md) or two (xl) so the
  // four charts beside it fill the grid.
  const even = factors.length % 2 === 0;
  const overall = useMemo(() => overallEfficiency(props.drives ?? []), [props.drives]);
  const average = efficiencyValue(overall.km, overall.kwh, u);

  // One scale for every chart, so bars compare across them.
  const max = Math.max(
    average ?? 0,
    ...factors.flatMap((f) => f.buckets.map((b) => efficiencyValue(b.km, b.kwh, u) ?? 0)),
  );

  return (
    <ContentFrame
      height="22rem"
      loading={props.loading}
      empty={average == null}
      emptyText="No finished drives with battery readings in this period."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <section
          className={`card flex flex-col p-5 sm:p-6 ${even ? 'md:col-span-2 xl:col-span-1 xl:row-span-2' : ''}`}
        >
          <h3 className="eyebrow text-(--text-secondary)">Average efficiency</h3>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="readout text-5xl font-[350]">{fmt(average, digits)}</span>
            <span className="text-base text-(--text-muted)">{unit}</span>
          </div>
          <p className="mt-1 text-sm text-(--text-secondary) tabular-nums">
            Over {overall.drives} drive{overall.drives === 1 ? '' : 's'},{' '}
            {u.formatDistance(overall.km)}
          </p>
        </section>

        {factors.map((f) => (
          <FactorChart
            key={f.key}
            factor={f}
            max={max}
            average={average}
            unit={unit}
            digits={digits}
            higherIsBetter={miles}
          />
        ))}
      </div>
    </ContentFrame>
  );
}

function FactorChart(props: {
  factor: EfficiencyFactor;
  max: number;
  average: number | null;
  unit: string;
  digits: number;
  higherIsBetter: boolean;
}) {
  const u = useUnits();
  const [hover, setHover] = useState<number | null>(null);
  const { buckets } = props.factor;
  const value = (b: EfficiencyBucket) => efficiencyValue(b.km, b.kwh, u);
  const height = (v: number | null) => (v == null || props.max <= 0 ? 0 : (v / props.max) * 100);

  // The best bucket with enough drives to trust, as the line to read when nothing's hovered.
  let best: number | null = null;
  buckets.forEach((b, i) => {
    const v = value(b);
    if (v == null || b.drives < FEW_DRIVES) return;
    const bv = best == null ? null : value(buckets[best]!);
    if (bv == null || (props.higherIsBetter ? v > bv : v < bv)) best = i;
  });
  const shown = hover ?? best;
  const shownBucket = shown == null ? null : buckets[shown]!;

  const describe = (b: EfficiencyBucket) => {
    const v = value(b);
    if (v == null) return `${b.label}: no drives`;
    return `${b.label}: ${fmt(v, props.digits)} ${props.unit}, ${b.drives} drive${b.drives === 1 ? '' : 's'}, ${u.formatDistance(b.km)}`;
  };

  return (
    <section className="card flex flex-col p-5 sm:p-6">
      <h3 className="eyebrow text-(--text-secondary)">{props.factor.title}</h3>
      <p className="mt-1.5 min-h-5 truncate text-xs text-(--text-muted) tabular-nums">
        {shownBucket ? (
          <>
            {hover == null && 'Best: '}
            <span className="text-(--text-secondary)">{shownBucket.label}</span>
            {value(shownBucket) != null ? (
              <>
                {' '}
                · {fmt(value(shownBucket), props.digits)} {props.unit} · {shownBucket.drives} drive
                {shownBucket.drives === 1 ? '' : 's'}
                {shownBucket.drives < FEW_DRIVES && ', rough'}
              </>
            ) : (
              ' · no drives'
            )}
          </>
        ) : (
          'Not enough drives yet'
        )}
      </p>

      <div
        className="relative mt-4 flex items-end gap-2 border-b border-(--hairline)"
        style={{ height: CHART_HEIGHT }}
        onMouseLeave={() => setHover(null)}
      >
        {props.average != null && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-(--text-muted)"
            style={{ bottom: `${height(props.average)}%` }}
          >
            <span className="absolute right-0 bottom-0.5 rounded bg-(--surface-1)/80 px-1 text-[10px] text-(--text-secondary) tabular-nums">
              avg {fmt(props.average, props.digits)} {props.unit}
            </span>
          </span>
        )}
        {buckets.map((b, i) => {
          const v = value(b);
          return (
            // The whole column is the hover target, not just the bar.
            <div
              key={b.label}
              role="img"
              aria-label={describe(b)}
              className="flex h-full flex-1 items-end"
              onMouseEnter={() => setHover(i)}
            >
              {v != null && (
                <div
                  className="w-full rounded-t-[4px] bg-(--series-1) transition-opacity"
                  style={{
                    height: `${height(v)}%`,
                    opacity: b.drives < FEW_DRIVES ? 0.35 : hover == null || hover === i ? 1 : 0.6,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2">
        {buckets.map((b, i) => (
          <span
            key={b.label}
            className={`min-w-0 flex-1 text-center text-[11px] leading-tight tabular-nums ${
              hover === i ? 'text-(--text-primary)' : 'text-(--text-muted)'
            }`}
          >
            {b.short}
          </span>
        ))}
      </div>
      {props.factor.ends && (
        <div className="mt-1 flex justify-between text-[11px] text-(--text-muted)">
          <span>{props.factor.ends[0]}</span>
          <span>{props.factor.ends[1]}</span>
        </div>
      )}
    </section>
  );
}
