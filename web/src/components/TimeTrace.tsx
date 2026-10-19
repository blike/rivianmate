import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { timeTicks } from '../features/history/timeAxis';
import type { StateSegment } from '../features/history/history';
import { STATE_STYLE } from '../features/history/states';
import { dateTime } from '../lib/format';
import { fmt } from '../lib/state';

export interface TracePoint {
  ts: number;
  value: number | null;
}

/** Shading behind the trace, e.g. drives and charging. */
export interface TraceBand {
  from: number;
  to: number;
  fill: string;
  label: string;
}

const W = 1000;

/**
 * Up to `count` round values spanning [min, max], for a value axis: steps
 * of 1, 2, 2.5 or 5 times a power of ten.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * power >= raw) ?? 10) * power;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

/**
 * The value at `ts`: the last reading at or before it (points in time order),
 * or null inside a gap, where the line breaks too.
 */
export function valueAt(points: readonly TracePoint[], ts: number): number | null {
  let found: number | null = null;
  for (const p of points) {
    if (p.ts > ts) break;
    found = p.value;
  }
  return found;
}

/**
 * A value over [from, to] on one time axis with what the vehicle was doing:
 * the line, optional shaded bands behind it, and a ribbon of vehicle states
 * under it. The pointer reads all three at once.
 */
export function TimeTrace(props: {
  from: number;
  to: number;
  points: readonly TracePoint[];
  /** The value axis; [0, 100] for a percentage. Fitted to the data when left out. */
  domain?: [number, number];
  unit: string;
  digits?: number;
  label: string;
  bands?: readonly TraceBand[];
  segments?: readonly StateSegment[];
  height?: number;
  /** Labels down the left for the value axis. */
  axis?: boolean;
  maxTicks?: number;
  color?: string;
  /** Reports the time under the pointer; null when it leaves. */
  onHover?: (ts: number | null) => void;
  /** Extra lines for the readout at the pointer. */
  readout?: (ts: number) => ReactNode;
}) {
  const id = useId().replace(/:/g, '');
  const height = props.height ?? 160;
  const color = props.color ?? 'var(--accent)';
  const span = props.to - props.from;
  const plotRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const values = props.points.flatMap((p) => (p.value != null ? [p.value] : []));
  const [lo, hi] = useMemo(() => {
    if (props.domain) return props.domain;
    if (values.length === 0) return [0, 1];
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (max - min < 1e-6) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.12;
    const ticks = niceTicks(min - pad, max + pad);
    return [Math.min(ticks[0]!, min - pad), Math.max(ticks.at(-1)!, max + pad)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.domain, props.points]);
  const yTicks = props.domain
    ? niceTicks(lo, hi, 4)
    : niceTicks(lo, hi, 4).filter((t) => t >= lo && t <= hi);

  const x = (ts: number) => ((ts - props.from) / span) * W;
  const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;

  // The line, broken where readings are missing; the last value holds to the end.
  const { line, area } = useMemo(() => {
    const runs: [number, number][][] = [];
    let run: [number, number][] = [];
    for (const p of props.points) {
      if (p.ts < props.from - span || p.ts > props.to) continue;
      if (p.value == null) {
        if (run.length) runs.push(run);
        run = [];
        continue;
      }
      run.push([Math.max(0, x(p.ts)), y(p.value)]);
    }
    if (run.length) {
      const last = run.at(-1)!;
      run.push([Math.min(W, x(Math.min(props.to, Date.now()))), last[1]]);
      runs.push(run);
    }
    const path = (r: [number, number][]) =>
      r.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
    return {
      line: runs.map(path).join(''),
      area: runs
        .map(
          (r) =>
            `${path(r)}L${r.at(-1)![0].toFixed(1)},${height}L${r[0]![0].toFixed(1)},${height}Z`,
        )
        .join(''),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.points, props.from, props.to, lo, hi, height]);

  const xAxis = useMemo(
    () => timeTicks(props.from, props.to, props.maxTicks ?? 7),
    [props.from, props.to, props.maxTicks],
  );

  const at = (clientX: number) => {
    const box = plotRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    const f = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return props.from + f * span;
  };
  const move = (clientX: number) => {
    const ts = at(clientX);
    setHover(ts);
    props.onHover?.(ts);
  };
  const leave = () => {
    setHover(null);
    props.onHover?.(null);
  };

  const hoverValue = hover != null ? valueAt(props.points, hover) : null;
  const hoverState =
    hover != null ? props.segments?.find((s) => hover >= s.from && hover < s.to) : undefined;
  const hoverBand =
    hover != null ? props.bands?.find((b) => hover >= b.from && hover <= b.to) : undefined;
  const hoverAt = hover != null ? (hover - props.from) / span : 0;

  return (
    <div className="flex gap-3">
      {props.axis && (
        <div
          className="relative w-9 shrink-0 text-right text-[11px] text-(--text-muted) tabular-nums"
          style={{ height }}
        >
          {yTicks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: y(t) }}>
              {fmt(t, Math.abs(hi - lo) < 5 ? 1 : 0)}
            </span>
          ))}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div
          ref={plotRef}
          className="relative touch-pan-y select-none"
          onPointerMove={(e) => move(e.clientX)}
          onPointerDown={(e) => move(e.clientX)}
          onPointerLeave={leave}
          role="img"
          aria-label={`${props.label} over time`}
        >
          <svg
            viewBox={`0 0 ${W} ${height}`}
            preserveAspectRatio="none"
            className="block w-full overflow-visible"
            style={{ height }}
            aria-hidden
          >
            <defs>
              <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.2} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            {yTicks.map((t) => (
              <line
                key={t}
                x1={0}
                x2={W}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--hairline)"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {xAxis.ticks.map((t) => (
              <line
                key={t}
                x1={x(t)}
                x2={x(t)}
                y1={0}
                y2={height}
                stroke="var(--hairline)"
                strokeDasharray="2 4"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {props.bands?.map((b) => (
              <rect
                key={`${b.label}-${b.from}`}
                x={x(Math.max(b.from, props.from))}
                width={Math.max(1.5, x(Math.min(b.to, props.to)) - x(Math.max(b.from, props.from)))}
                y={0}
                height={height}
                fill={b.fill}
              />
            ))}
            <path d={area} fill={`url(#${id}-fill)`} />
            <path
              d={line}
              fill="none"
              stroke={color}
              strokeWidth={1.75}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {props.segments && (
            <div className="relative mt-2.5 h-2 overflow-hidden rounded-full bg-(--surface-2)">
              {props.segments.map((s) => (
                <span
                  key={s.from}
                  className="absolute inset-y-0"
                  style={{
                    left: `${((s.from - props.from) / span) * 100}%`,
                    width: `max(2px, ${((s.to - s.from) / span) * 100}%)`,
                    background: STATE_STYLE[s.state].fill,
                  }}
                />
              ))}
            </div>
          )}

          {hover != null && (
            <>
              <span
                aria-hidden
                className="pointer-events-none absolute top-0 bottom-0 w-px bg-(--text-secondary)/60"
                style={{ left: `${hoverAt * 100}%` }}
              />
              {hoverValue != null && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-(--surface-1)"
                  style={{ left: `${hoverAt * 100}%`, top: y(hoverValue), background: color }}
                />
              )}
              <div
                className="pointer-events-none absolute -top-2 z-10 min-w-36 rounded-lg border border-(--hairline) bg-(--surface-2) px-3 py-2 text-xs shadow-[0_12px_32px_-12px_rgb(0_0_0/0.8)]"
                style={{
                  left: `${hoverAt * 100}%`,
                  transform: `translate(${hoverAt < 0.15 ? '0' : hoverAt > 0.85 ? '-100%' : '-50%'}, -100%)`,
                }}
              >
                <div className="text-(--text-muted)">{dateTime(hover)}</div>
                <div className="mt-1 flex items-baseline justify-between gap-4">
                  <span className="text-(--text-secondary)">{props.label}</span>
                  <span className="font-medium text-(--text-primary) tabular-nums">
                    {fmt(hoverValue, props.digits ?? 0)}
                    <span className="ml-0.5 font-normal text-(--text-muted)">{props.unit}</span>
                  </span>
                </div>
                {(hoverState || hoverBand) && (
                  <div className="mt-1 flex items-center gap-1.5 text-(--text-secondary)">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{
                        background: hoverState
                          ? STATE_STYLE[hoverState.state].swatch
                          : hoverBand!.fill,
                      }}
                    />
                    {hoverBand?.label ?? STATE_STYLE[hoverState!.state].label}
                  </div>
                )}
                {props.readout?.(hover)}
              </div>
            </>
          )}
        </div>

        <div className="relative mt-2 h-4 text-[11px] text-(--text-muted) tabular-nums">
          {xAxis.ticks.map((t) => {
            const f = (t - props.from) / span;
            return (
              <span
                key={t}
                className="absolute whitespace-nowrap"
                style={{
                  left: `${f * 100}%`,
                  transform: `translateX(${f < 0.04 ? '0' : f > 0.96 ? '-100%' : '-50%'})`,
                }}
              >
                {xAxis.format(t)}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
