import type { ChargingSchedule, DepartureSchedule } from '@server/api-types';
import { useEffect, useState } from 'react';
import { useSchedules, useUnits } from '../../api/hooks';
import { Dot } from '../../components/Dot';
import { Skeleton, SkeletonBlock } from '../../components/LoadingState';
import { SectionRule } from '../../components/PageHeader';
import { Panel } from '../../components/Panel';
import {
  dayLabel,
  departureComfort,
  formatDuration,
  formatTimeOfDay,
  formatTimeRange,
  formatWait,
  formatWeekDays,
  scheduleStatus,
  weekSpans,
} from './schedules';

/**
 * Read-only view of the charging and departure schedules set in the Rivian
 * app, as a card each. Schedules switched off are left out; Rivian returns
 * those too.
 */
export function SchedulesSection(props: { vehicleId: string }) {
  const { data, isPending } = useSchedules(props.vehicleId);
  const charging = data?.charging?.filter((c) => c.enabled !== false);
  // Only the next window, from Parallax, when Rivian doesn't send the schedules (an R2).
  const nextOnly = data?.chargingFromParallax ?? false;
  const departures = data?.departures?.filter((d) => d.enabled !== false);
  const now = useMinuteClock();

  // Left out where Rivian doesn't provide them (no legacy feed, as on an R2).
  const showDepartures = !data?.departuresUnavailable;
  // The week chart wants the width; a lone next window keeps to half.
  const withWeek = !nextOnly && (isPending || !!charging?.length);
  const columns = withWeek
    ? showDepartures
      ? 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'
      : ''
    : 'md:grid-cols-2';

  return (
    <section>
      <SectionRule>Schedules</SectionRule>
      <div className={`grid grid-cols-1 gap-4 ${columns}`}>
        <Panel title="Charging schedule" className="@container">
          <div className="grid grid-cols-1 gap-x-8 gap-y-6 @xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="min-w-0 space-y-5">
              {isPending ? (
                <NextSkeleton />
              ) : (
                <NextWindow
                  schedules={charging ?? []}
                  now={now}
                  loaded={charging != null}
                  amps={nextOnly ? charging?.[0]?.amperage : undefined}
                />
              )}

              {/* Parallax sends only the next window, and the window above says when there are none. */}
              {(isPending || (!nextOnly && !!charging?.length)) && (
                <div className="border-t border-(--border) pt-3">
                  {isPending ? (
                    <SkeletonBlock height="2.5rem" />
                  ) : (
                    <ul className="divide-y divide-(--border)">
                      {charging!.map((c, i) => (
                        <ScheduleRow
                          key={i}
                          days={formatWeekDays(c.weekDays)}
                          time={formatTimeRange(c.startTime, c.duration)}
                          detail={[
                            c.duration ? formatDuration(c.duration) : null,
                            c.amperage ? `${c.amperage} A` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {withWeek && (
              <div className="min-w-0">
                {isPending ? (
                  <SkeletonBlock height="12rem" />
                ) : (
                  <ChargingWeek schedules={charging!} now={now} />
                )}
              </div>
            )}
          </div>
        </Panel>

        {showDepartures && (
          <Panel title="Departures">
            <div className="space-y-3">
              {isPending ? (
                <NextSkeleton />
              ) : (
                <NextDeparture departures={departures ?? []} now={now} />
              )}
              {!!departures?.length && (
                <ul className="divide-y divide-(--border) border-t border-(--border)">
                  {departures.map((d) => (
                    <DepartureRow key={d.id} departure={d} />
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        )}
      </div>
    </section>
  );
}

function NextSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="w-[10em]" />
      <Skeleton className="block h-7 w-[14em]" />
    </div>
  );
}

/** The current time, ticking each minute. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const formatClock = (d: Date) => formatTimeOfDay(d.getHours() * 60 + d.getMinutes());
const until = (d: Date, now: Date) => formatWait((d.getTime() - now.getTime()) / 1000);

/** The window that's open now, or the next one, up front. */
function NextWindow(props: {
  schedules: ChargingSchedule[];
  now: Date;
  loaded: boolean;
  /** Shown with the window when there's no schedule list to carry it. */
  amps?: number | null;
}) {
  const amps = props.amps ? ` · ${props.amps} A` : '';
  const status = scheduleStatus(props.schedules, props.now);
  if (!status) {
    return (
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-(--text-muted)">
          Charging
        </div>
        <div className="mt-1 text-xl font-semibold tracking-tight">Any time</div>
        <div className="mt-0.5 text-sm text-(--text-secondary)">
          {props.loaded
            ? 'No schedule limits when the vehicle charges.'
            : 'Schedules haven’t loaded yet.'}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div
        className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide"
        style={{ color: status.open ? 'var(--accent)' : 'var(--text-muted)' }}
      >
        <Dot color={status.open ? 'var(--accent)' : 'var(--text-muted)'} pulse={status.open} />
        {status.open ? 'Charging window open' : 'Next charging window'}
      </div>
      <div className="mt-1 text-xl font-semibold tracking-tight">
        {status.open
          ? `Until ${formatClock(status.endsAt)}`
          : `${capitalize(dayLabel(status.startsAt, props.now))} at ${formatClock(status.startsAt)}`}
      </div>
      <div className="mt-0.5 text-sm tabular-nums text-(--text-secondary)">
        {status.open
          ? `${until(status.endsAt, props.now)} left${amps}`
          : `In ${until(status.startsAt, props.now)} · until ${formatClock(status.endsAt)}${amps}`}
      </div>
    </div>
  );
}

/** The next departure up front, styled like NextWindow. */
function NextDeparture(props: { departures: DepartureSchedule[]; now: Date }) {
  // Each departure as a one-minute window, to find the next one.
  const status = scheduleStatus(
    props.departures.map((d) => ({
      startTime: d.occurrence?.timeOfDayMinutes ?? null,
      duration: 1,
      weekDays: d.occurrence?.weekDays ?? null,
    })),
    props.now,
  );
  const next = status && !status.open ? status.startsAt : null;
  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-(--text-muted)">
        <Dot color="var(--text-muted)" />
        Next departure
      </div>
      <div className="mt-1 text-xl font-semibold tracking-tight">
        {status?.open
          ? 'Now'
          : next
            ? `${capitalize(dayLabel(next, props.now))} at ${formatClock(next)}`
            : 'None set'}
      </div>
      {!status?.open && (
        <div className="mt-0.5 text-sm tabular-nums text-(--text-secondary)">
          {next ? `In ${until(next, props.now)}` : 'Departures set in the Rivian app show here.'}
        </div>
      )}
    </div>
  );
}

/** "Weekdays    12:00 – 6:00 AM", with its length and amperage underneath. */
function ScheduleRow(props: { days: string; time: string; detail: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-2">
      <span className="text-sm font-medium">{props.days}</span>
      <span className="text-right">
        <span className="block text-sm tabular-nums">{props.time}</span>
        {props.detail && (
          <span className="block text-xs tabular-nums text-(--text-muted)">{props.detail}</span>
        )}
      </span>
    </li>
  );
}

function DepartureRow(props: { departure: DepartureSchedule }) {
  const u = useUnits();
  const d = props.departure;
  const comfort = [
    d.comfortSettings?.cabinClimateSetTemp != null &&
      `Cabin ${u.formatTemperature(d.comfortSettings.cabinClimateSetTemp)}`,
    ...departureComfort(d.comfortSettings?.surfaces ?? {}, d.comfortSettings?.defrost),
  ].filter((c): c is string => !!c);
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-4">
        <span className="min-w-0 truncate text-sm font-medium">{d.name ?? 'Departure'}</span>
        <span className="text-sm tabular-nums">
          {formatTimeOfDay(d.occurrence?.timeOfDayMinutes)}
        </span>
      </div>
      <div className="text-xs text-(--text-muted)">{formatWeekDays(d.occurrence?.weekDays)}</div>
      {comfort.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {comfort.map((c) => (
            <li
              key={c}
              className="rounded-full bg-(--surface-2) px-2 py-0.5 text-xs text-(--text-secondary)"
            >
              {c}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pct = (minutes: number) => `${(minutes / 1440) * 100}%`;

/** Charging windows across the week, with now marked on today. */
function ChargingWeek(props: { schedules: ChargingSchedule[]; now: Date }) {
  const week = weekSpans(props.schedules);
  const today = (props.now.getDay() + 6) % 7;
  const nowMinutes = props.now.getHours() * 60 + props.now.getMinutes();

  return (
    <div
      role="img"
      aria-label={props.schedules
        .map((c) => `${formatWeekDays(c.weekDays)} ${formatTimeRange(c.startTime, c.duration)}`)
        .join('; ')}
    >
      <h4 className="mb-3 text-xs uppercase tracking-wide text-(--text-muted)">This week</h4>
      <div className="relative">
        {/* Faint guides at 6a, 12p and 6p behind the rows. */}
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-11 right-0">
          {[6, 12, 18].map((h) => (
            <span
              key={h}
              className="absolute inset-y-0 w-px bg-(--border) opacity-60"
              style={{ left: pct(h * 60) }}
            />
          ))}
        </div>
        <div className="space-y-2">
          {week.map((spans, day) => (
            <div key={day} className="flex items-center gap-3">
              <span
                className={`w-8 shrink-0 text-xs ${day === today ? 'font-semibold text-(--accent)' : 'text-(--text-muted)'}`}
              >
                {DAY_LABELS[day]}
              </span>
              <div
                className={`relative h-3.5 flex-1 overflow-hidden rounded-full ${
                  day === today
                    ? 'bg-[color-mix(in_srgb,var(--surface-2)_70%,var(--text-muted))]'
                    : 'bg-(--surface-2)'
                }`}
              >
                {spans.map(([start, end], i) => (
                  <div
                    key={i}
                    // Square ends; the track rounds the day's edges, so a window
                    // crossing midnight reads as one piece.
                    className="absolute inset-y-0 rounded-[3px] bg-(--accent)"
                    style={{
                      left: pct(start),
                      width: pct(end - start),
                      opacity: day === today ? 1 : 0.7,
                    }}
                  />
                ))}
                {day === today && (
                  <div
                    className="absolute inset-y-0 w-0.5 bg-(--text-primary) shadow-[0_0_0_2px_var(--surface-1)]"
                    style={{ left: pct(nowMinutes) }}
                    title="Now"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="relative ml-11 mt-2 h-4 text-[10px] text-(--text-muted)">
        {[0, 6, 12, 18, 24].map((h) => (
          <span
            key={h}
            className="absolute"
            style={{
              left: pct(h * 60),
              transform: `translateX(${h === 0 ? '0' : h === 24 ? '-100%' : '-50%'})`,
            }}
          >
            {hourLabel(h)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Axis labels: "12a", "6a", "12p", "6p". */
function hourLabel(h: number): string {
  const hour = h % 24;
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${hour < 12 ? 'a' : 'p'}`;
}
