import { useMemo, useState } from 'react';
import type { DriveDto } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { ContentFrame } from '../../components/LoadingState';
import { drivingRhythm } from './patterns';

/** Monday first, as the grid is. */
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Date(2026, 9, 12 + i).toLocaleDateString([], { weekday: 'short' }),
);
const PLURAL = Array.from({ length: 7 }, (_, i) =>
  new Date(2026, 9, 12 + i).toLocaleDateString([], { weekday: 'long' }),
);
const hourLabel = (h: number) =>
  new Date(2026, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });

/** When drives start: weekday by hour, brighter the more often. */
export function RhythmPanel(props: {
  drives: DriveDto[] | undefined;
  loading: boolean;
  from: Date;
  to: Date;
}) {
  const u = useUnits();
  const rhythm = useMemo(
    () => drivingRhythm(props.drives ?? [], props.from.getTime(), props.to.getTime()),
    [props.drives, props.from, props.to],
  );
  const [hover, setHover] = useState<[number, number] | null>(null);
  // The busiest slot, as the line to read when nothing's under the pointer.
  let peak: [number, number] | null = null;
  rhythm.count.forEach((row, d) =>
    row.forEach((n, h) => {
      if (n > 0 && (!peak || n > rhythm.count[peak[0]]![peak[1]]!)) peak = [d, h];
    }),
  );
  const shown: [number, number] | null = hover ?? peak;

  return (
    <section className="card flex h-full flex-col p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="eyebrow text-(--text-secondary)">Driving rhythm</h2>
        <span className="text-xs text-(--text-muted) tabular-nums">
          {shown &&
            (() => {
              const [d, h] = shown;
              const n = rhythm.count[d]![h]!;
              return (
                <>
                  {hover ? '' : 'Most often '}
                  {PLURAL[d]}s, {hourLabel(h)} ·{' '}
                  <span className="text-(--text-secondary)">
                    {n} drive{n === 1 ? '' : 's'}
                    {n > 0 && `, ${u.formatDistance(rhythm.km[d]![h]!)}`}
                  </span>
                </>
              );
            })()}
        </span>
      </div>
      <ContentFrame
        height="13rem"
        loading={props.loading}
        empty={rhythm.max === 0}
        emptyText="No drives in this period."
      >
        <div onPointerLeave={() => setHover(null)}>
          <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-y-1">
            {rhythm.count.map((row, d) => (
              <div key={d} className="contents">
                <span className="self-center text-[11px] text-(--text-muted)">{WEEKDAYS[d]}</span>
                <div className="grid grid-cols-24 gap-0.75">
                  {row.map((n, h) => {
                    const on = hover?.[0] === d && hover[1] === h;
                    // Square root, so a single drive still shows against a busy hour.
                    const strength = n === 0 ? 0 : 0.18 + 0.82 * Math.sqrt(n / rhythm.max);
                    return (
                      <span
                        key={h}
                        className="aspect-square min-h-3 rounded-[3px]"
                        style={{
                          background:
                            n === 0
                              ? 'var(--surface-2)'
                              : `color-mix(in srgb, var(--accent) ${Math.round(strength * 100)}%, var(--surface-2))`,
                          outline: on ? '1.5px solid var(--text-primary)' : undefined,
                          outlineOffset: 1,
                        }}
                        onPointerEnter={() => setHover([d, h])}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 ml-9 grid grid-cols-4 text-[10.5px] text-(--text-muted)">
            {[0, 6, 12, 18].map((h) => (
              <span key={h}>{hourLabel(h)}</span>
            ))}
          </div>
        </div>
      </ContentFrame>
    </section>
  );
}
