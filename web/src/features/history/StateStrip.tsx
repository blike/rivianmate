import { useMemo, useRef, useState } from 'react';
import { dateTime } from '../../lib/format';
import { fmtSeconds } from '../../lib/state';
import { type StateSegment, awakeStretches } from './history';
import { STATE_ORDER, STATE_STYLE } from './states';

/** Awake while parked this long or more is worth a look. */
const LONG_AWAKE_MS = 30 * 60_000;
const LONG_FILL = 'var(--status-warning)';

/**
 * The vehicle's state across the period as one strip, with long stretches
 * awake while parked marked, then its legend. Indented to line up with a
 * chart that has a value axis (`gutter`) above it.
 */
export function StateStrip(props: {
  segments: readonly StateSegment[];
  from: number;
  to: number;
  gutter?: boolean;
  onHover?: (ts: number | null) => void;
}) {
  const { from, to, segments } = props;
  const span = to - from;
  const stretches = useMemo(() => awakeStretches(segments), [segments]);
  const long = stretches.filter((s) => s.to - s.from >= LONG_AWAKE_MS);
  const awakeMs = stretches.reduce((sum, s) => sum + (s.to - s.from), 0);
  const states = STATE_ORDER.filter((k) => segments.some((s) => s.state === k));

  const stripRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const move = (clientX: number) => {
    const box = stripRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const ts = from + Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * span;
    setHover(ts);
    props.onHover?.(ts);
  };
  const leave = () => {
    setHover(null);
    props.onHover?.(null);
  };
  const left = (ts: number) => `${((Math.max(from, ts) - from) / span) * 100}%`;
  const width = (s: { from: number; to: number }) =>
    `max(2px, ${((Math.min(to, s.to) - Math.max(from, s.from)) / span) * 100}%)`;

  const hoverSegment = hover != null ? segments.find((s) => hover >= s.from && hover < s.to) : null;
  const hoverStretch = hover != null ? long.find((s) => hover >= s.from && hover < s.to) : null;
  const hoverAt = hover != null ? (hover - from) / span : 0;

  return (
    <div>
      <div className="flex gap-3">
        {props.gutter && <div className="w-9 shrink-0" />}
        <div
          ref={stripRef}
          className="relative h-5 min-w-0 flex-1 touch-pan-y select-none rounded-md bg-(--surface-2)"
          onPointerMove={(e) => move(e.clientX)}
          onPointerDown={(e) => move(e.clientX)}
          onPointerLeave={leave}
          role="img"
          aria-label={`Vehicle state over time; ${long.length} stretches awake while parked for 30 minutes or more`}
        >
          <div className="absolute inset-0 overflow-hidden rounded-md">
            {segments.map((s) => (
              <span
                key={s.from}
                className="absolute inset-y-0"
                style={{
                  left: left(s.from),
                  width: width(s),
                  background: STATE_STYLE[s.state].fill,
                }}
              />
            ))}
            {long.map((s) => (
              <span
                key={s.from}
                className="absolute inset-y-0"
                style={{ left: left(s.from), width: width(s), background: LONG_FILL }}
              />
            ))}
          </div>

          {hover != null && (
            <>
              <span
                aria-hidden
                className="pointer-events-none absolute -top-1 -bottom-1 w-px bg-(--text-secondary)/60"
                style={{ left: `${hoverAt * 100}%` }}
              />
              <div
                className="pointer-events-none absolute -top-2 z-10 min-w-36 rounded-lg border border-(--hairline) bg-(--surface-2) px-3 py-2 text-xs shadow-[0_12px_32px_-12px_rgb(0_0_0/0.8)]"
                style={{
                  left: `${hoverAt * 100}%`,
                  transform: `translate(${hoverAt < 0.15 ? '0' : hoverAt > 0.85 ? '-100%' : '-50%'}, -100%)`,
                }}
              >
                <div className="text-(--text-muted)">{dateTime(hover)}</div>
                <div className="mt-1 flex items-center gap-1.5 text-(--text-secondary)">
                  {hoverSegment ? (
                    <>
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          background: hoverStretch
                            ? LONG_FILL
                            : STATE_STYLE[hoverSegment.state].swatch,
                        }}
                      />
                      {hoverStretch
                        ? `Awake while parked, ${fmtSeconds((hoverStretch.to - hoverStretch.from) / 1000)}`
                        : STATE_STYLE[hoverSegment.state].label}
                    </>
                  ) : (
                    'No state recorded'
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-(--text-muted)">
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
          {states.map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span
                className="h-2 w-3.5 rounded-full"
                style={{ background: STATE_STYLE[k].fill }}
              />
              {STATE_STYLE[k].label}
            </li>
          ))}
          {long.length > 0 && (
            <li className="flex items-center gap-1.5">
              <span className="h-2 w-3.5 rounded-full" style={{ background: LONG_FILL }} />
              Awake 30 min+ while parked
            </li>
          )}
        </ul>
        {awakeMs > 0 && (
          <span className="tabular-nums">
            Awake while parked{' '}
            <span className="text-(--text-secondary)">{fmtSeconds(awakeMs / 1000)}</span>
            {long.length > 0 && (
              <>
                {' '}
                · <span className="text-(--text-secondary)">{long.length}</span> long stretch
                {long.length === 1 ? '' : 'es'}
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
