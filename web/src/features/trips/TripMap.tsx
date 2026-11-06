import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TripDetailDto, TripRouteDto } from '../../api/client';
import { SkeletonBlock } from '../../components/LoadingState';
import { chargerLabel } from '../../lib/charging';
import { clock, shortDate } from '../../lib/format';
import { fmtDuration } from '../../lib/state';
import { JourneyMap } from './JourneyMap';
import {
  type JourneyDay,
  type JourneyStop,
  journeyDays,
  journeyLegs,
  journeyStops,
  replayFrame,
} from './journey';
import { driveTitle } from '../drives/format';
import type { Selection } from './TripTimeline';
import { dayLabel, overnightLabel } from './trips';

/** More days than this get a stepper: a row of chips would crowd the map. */
const MAX_DAY_CHIPS = 5;

/** A whole replay, whatever the trip's length. */
const REPLAY_MS = 24_000;

/** When, then what: "Oct 30, 2:10 PM · Overnight · 14h 10m · Charged at Home". */
function describeStop(stop: JourneyStop): string {
  const when = `${shortDate(Date.parse(stop.startedAt))}, ${clock(stop.startedAt)}`;
  const parts = [
    stop.kind === 'start' ? `Left ${when}` : stop.kind === 'end' ? `Back ${when}` : when,
  ];
  if (stop.nights > 0) parts.push(overnightLabel(stop.nights));
  if (stop.endedAt) parts.push(fmtDuration(stop.startedAt, stop.endedAt));
  for (const c of stop.charges) parts.push(`Charged at ${chargerLabel(c)}`);
  return parts.join(' · ');
}

/** The map and what steers it: the days, and the replay. */
export function TripMap(props: {
  trip: TripDetailDto | undefined;
  routes: TripRouteDto[] | undefined;
  selected: Selection;
  onSelect: (selection: Selection) => void;
  focusDay: string | null;
  onFocusDay: (day: string | null) => void;
}) {
  const { trip, routes, focusDay, onFocusDay } = props;
  const drives = trip?.drives;
  const sessions = trip?.sessions;
  const days = useMemo(() => journeyDays(drives ?? [], sessions ?? []), [drives, sessions]);
  const legs = useMemo(() => journeyLegs(drives ?? [], routes ?? [], days), [drives, routes, days]);
  const stops = useMemo(() => journeyStops(drives ?? [], sessions ?? []), [drives, sessions]);

  const [progress, setProgress] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const progressRef = useRef(0);
  useLayoutEffect(() => {
    progressRef.current = progress ?? 0;
  });
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(1, progressRef.current + (now - last) / REPLAY_MS);
      last = now;
      setProgress(next);
      if (next >= 1) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const showDay = (day: string | null) => {
    props.onSelect(null);
    setProgress(null);
    setPlaying(false);
    onFocusDay(day);
  };

  const canReplay = legs.length > 0;
  const currentLeg = progress != null ? replayFrame(legs, progress).leg : null;
  const hasPlace = legs.length > 0 || stops.some((s) => s.at);

  if (!trip || !routes) return <SkeletonBlock height="100%" />;
  if (!hasPlace) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-(--text-muted)">
        No locations to show yet.
      </p>
    );
  }

  return (
    <div className="relative h-full">
      <JourneyMap
        legs={legs}
        stops={stops}
        focusDay={focusDay}
        selected={props.selected}
        onSelect={props.onSelect}
        replay={progress}
        describeStop={describeStop}
      />
      {days.length > 1 && days.length <= MAX_DAY_CHIPS && (
        <div
          role="group"
          aria-label="Show a day"
          className="absolute top-3 left-3 flex max-w-[calc(100%-4.5rem)] gap-1.5 overflow-x-auto"
        >
          <DayChip label="All" active={focusDay == null} onClick={() => showDay(null)} />
          {days.map((d) => (
            <DayChip
              key={d.key}
              label={dayLabel(d.key)}
              color={d.color}
              active={focusDay === d.key}
              onClick={() => showDay(focusDay === d.key ? null : d.key)}
            />
          ))}
        </div>
      )}
      {days.length > MAX_DAY_CHIPS && (
        <DayStepper days={days} focusDay={focusDay} onShow={showDay} />
      )}
      {canReplay && (
        <div className="rm-journey-player absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-lg px-3 py-2 sm:right-auto sm:w-[min(30rem,calc(100%-7rem))]">
          <button
            type="button"
            aria-label={playing ? 'Pause replay' : 'Replay the journey'}
            className="grid size-7 shrink-0 place-items-center rounded-full bg-(--accent) text-(--on-accent)"
            onClick={() => {
              if (playing) {
                setPlaying(false);
                return;
              }
              props.onSelect(null);
              onFocusDay(null);
              if (progress == null || progress >= 1) setProgress(0);
              setPlaying(true);
            }}
          >
            <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden>
              <path d={playing ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5v14l11-7z'} />
            </svg>
          </button>
          {progress == null ? (
            <span className="truncate text-xs text-(--text-secondary)">Replay the journey</span>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-(--text-secondary)">
                  {currentLeg ? driveTitle(currentLeg.title) : ''}
                </div>
                <input
                  type="range"
                  min={0}
                  max={1000}
                  aria-label="Position in the journey"
                  value={Math.round(progress * 1000)}
                  onChange={(e) => {
                    setPlaying(false);
                    setProgress(Number(e.target.value) / 1000);
                  }}
                  className="block w-full accent-(--accent)"
                />
              </div>
              <button
                type="button"
                className="shrink-0 text-xs text-(--text-muted) hover:text-(--text-primary)"
                onClick={() => {
                  setPlaying(false);
                  setProgress(null);
                }}
              >
                Close
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DayChip(props: { label: string; color?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      onClick={props.onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap backdrop-blur ${
        props.active
          ? 'border-(--text-muted) bg-(--surface-3) text-(--text-primary)'
          : 'border-(--border) bg-(--surface-1)/85 text-(--text-secondary) hover:text-(--text-primary)'
      }`}
    >
      {props.color && (
        <span className="size-2 rounded-full" style={{ background: props.color }} aria-hidden />
      )}
      {props.label}
    </button>
  );
}

/** Steps through a long trip a day at a time, either side of all of it. */
function DayStepper(props: {
  days: readonly JourneyDay[];
  focusDay: string | null;
  onShow: (day: string | null) => void;
}) {
  const { days, focusDay, onShow } = props;
  const at = days.findIndex((d) => d.key === focusDay);
  const day = at >= 0 ? days[at]! : null;
  // From all days, back is the last day and forward the first; past either end is all again.
  const go = (step: -1 | 1) => {
    const next = at < 0 ? (step > 0 ? 0 : days.length - 1) : at + step;
    onShow(days[next]?.key ?? null);
  };
  const arrow =
    'grid size-7 place-items-center rounded-full text-(--text-secondary) hover:bg-(--surface-3) hover:text-(--text-primary)';
  return (
    <div
      role="group"
      aria-label="Show a day"
      className="absolute top-3 left-3 flex items-center gap-1 rounded-full border border-(--border) bg-(--surface-1)/85 p-0.5 text-xs backdrop-blur"
    >
      <button type="button" aria-label="Previous day" className={arrow} onClick={() => go(-1)}>
        <Chevron d="M10 3.5 5.5 8l4.5 4.5" />
      </button>
      <span className="flex min-w-36 items-center justify-center gap-1.5 px-1 tabular-nums">
        {day ? (
          <>
            <span aria-hidden className="size-2 rounded-full" style={{ background: day.color }} />
            {dayLabel(day.key)}
            <span className="text-(--text-muted)">
              day {at + 1} of {days.length}
            </span>
          </>
        ) : (
          `All ${days.length} days`
        )}
      </span>
      <button type="button" aria-label="Next day" className={arrow} onClick={() => go(1)}>
        <Chevron d="M6 3.5 10.5 8 6 12.5" />
      </button>
      {day && (
        <button
          type="button"
          className="rounded-full px-2 py-1 text-(--text-muted) hover:text-(--text-primary)"
          onClick={() => onShow(null)}
        >
          All
        </button>
      )}
    </div>
  );
}

/** The calendar's month-step chevron, so stepping through days looks the same. */
function Chevron(props: { d: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={props.d} />
    </svg>
  );
}
