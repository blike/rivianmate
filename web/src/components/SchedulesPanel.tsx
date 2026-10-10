import type { ChargingSchedule, DepartureSchedule } from "@server/api-types.js";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client.js";
import { useUnits } from "../api/hooks.js";
import {
  dayLabel,
  formatDuration,
  formatSeatLevel,
  formatTimeOfDay,
  formatTimeRange,
  formatWait,
  formatWeekDays,
  scheduleStatus,
  weekSpans,
} from "../lib/schedules.js";
import { Skeleton, SkeletonBlock } from "./loading.js";
import { Panel } from "./panels.js";

/**
 * Read-only view of the charging and departure schedules set in the Rivian
 * app. Schedules switched off are left out; Rivian returns those too.
 */
export function SchedulesPanel(props: { vehicleId: string; className?: string }) {
  const { data, isPending } = useQuery({
    queryKey: ["schedules", props.vehicleId],
    queryFn: () => api.schedules(props.vehicleId),
    refetchInterval: 5 * 60_000,
  });
  const charging = data?.charging?.filter((c) => c.enabled !== false);
  const departures = data?.departures?.filter((d) => d.enabled !== false);
  const now = useMinuteClock();

  return (
    <Panel title="Schedules" className={`@container ${props.className ?? ""}`}>
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 @2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-w-0 space-y-5">
          {isPending ? (
            <div className="space-y-2">
              <Skeleton className="w-[10em]" />
              <Skeleton className="block h-7 w-[14em]" />
            </div>
          ) : (
            <NextWindow schedules={charging ?? []} now={now} loaded={charging != null} />
          )}

          <Section title="Charging schedules">
            {isPending ? (
              <SkeletonBlock height="2.5rem" />
            ) : !charging?.length ? (
              <Empty>{charging == null ? "Not loaded yet." : "None set in the Rivian app."}</Empty>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {charging.map((c, i) => (
                  <ScheduleRow
                    key={i}
                    days={formatWeekDays(c.weekDays)}
                    time={formatTimeRange(c.startTime, c.duration)}
                    detail={[c.duration ? formatDuration(c.duration) : null, c.amperage ? `${c.amperage} A` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                ))}
              </ul>
            )}
          </Section>

          <Section title="Departures">
            {isPending ? (
              <SkeletonBlock height="2.5rem" />
            ) : data?.departuresUnavailable ? (
              <Empty>Rivian doesn’t provide departure schedules for this vehicle.</Empty>
            ) : !departures?.length ? (
              <Empty>None set in the Rivian app.</Empty>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {departures.map((d) => (
                  <DepartureRow key={d.id} departure={d} />
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="min-w-0">
          {isPending ? (
            <SkeletonBlock height="12rem" />
          ) : charging?.length ? (
            <ChargingWeek schedules={charging} now={now} />
          ) : null}
        </div>
      </div>
    </Panel>
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
function NextWindow(props: { schedules: ChargingSchedule[]; now: Date; loaded: boolean }) {
  const status = scheduleStatus(props.schedules, props.now);
  if (!status) {
    return (
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Charging</div>
        <div className="mt-1 text-xl font-semibold tracking-tight">Any time</div>
        <div className="mt-0.5 text-sm text-[var(--text-secondary)]">
          {props.loaded ? "No schedule limits when the vehicle charges." : "Schedules haven’t loaded yet."}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div
        className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide"
        style={{ color: status.open ? "var(--accent)" : "var(--text-muted)" }}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${status.open ? "chip-dot--pulse" : ""}`}
          style={{ background: status.open ? "var(--accent)" : "var(--text-muted)", color: "var(--accent)" }}
        />
        {status.open ? "Charging window open" : "Next charging window"}
      </div>
      <div className="mt-1 text-xl font-semibold tracking-tight">
        {status.open
          ? `Until ${formatClock(status.endsAt)}`
          : `${capitalize(dayLabel(status.startsAt, props.now))} at ${formatClock(status.startsAt)}`}
      </div>
      <div className="mt-0.5 text-sm tabular-nums text-[var(--text-secondary)]">
        {status.open
          ? `${until(status.endsAt, props.now)} left`
          : `In ${until(status.startsAt, props.now)} · until ${formatClock(status.endsAt)}`}
      </div>
    </div>
  );
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 border-t border-[var(--border)] pt-4">
      <h4 className="mb-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">{props.title}</h4>
      {props.children}
    </section>
  );
}

function Empty(props: { children: ReactNode }) {
  return <p className="py-1 text-sm text-[var(--text-muted)]">{props.children}</p>;
}

/** "Weekdays    12:00 – 6:00 AM", with its length and amperage underneath. */
function ScheduleRow(props: { days: string; time: string; detail: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-2">
      <span className="text-sm font-medium">{props.days}</span>
      <span className="text-right">
        <span className="block text-sm tabular-nums">{props.time}</span>
        {props.detail && <span className="block text-xs tabular-nums text-[var(--text-muted)]">{props.detail}</span>}
      </span>
    </li>
  );
}

function DepartureRow(props: { departure: DepartureSchedule }) {
  const u = useUnits();
  const d = props.departure;
  const comfort = [
    d.comfortSettings?.cabinClimateSetTemp != null && `Cabin ${u.formatTemperature(d.comfortSettings.cabinClimateSetTemp)}`,
    d.comfortSettings?.seatFrontLeftHeat != null && `Driver seat ${formatSeatLevel(d.comfortSettings.seatFrontLeftHeat).toLowerCase()}`,
  ].filter(Boolean);
  return (
    <li className="flex items-baseline justify-between gap-4 py-2">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{d.name ?? "Departure"}</span>
        <span className="block text-xs text-[var(--text-muted)]">{formatWeekDays(d.occurrence?.weekDays)}</span>
      </span>
      <span className="text-right">
        <span className="block text-sm tabular-nums">{formatTimeOfDay(d.occurrence?.timeOfDayMinutes)}</span>
        {comfort.length > 0 && <span className="block text-xs text-[var(--text-muted)]">{comfort.join(" · ")}</span>}
      </span>
    </li>
  );
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pct = (minutes: number) => `${(minutes / 1440) * 100}%`;

/** Charging windows across the week, with now marked on today. */
function ChargingWeek(props: { schedules: ChargingSchedule[]; now: Date }) {
  const week = weekSpans(props.schedules);
  const today = (props.now.getDay() + 6) % 7;
  const nowMinutes = props.now.getHours() * 60 + props.now.getMinutes();

  return (
    <div
      role="img"
      aria-label={props.schedules.map((c) => `${formatWeekDays(c.weekDays)} ${formatTimeRange(c.startTime, c.duration)}`).join("; ")}
    >
      <h4 className="mb-3 text-xs uppercase tracking-wide text-[var(--text-muted)]">This week</h4>
      <div className="relative">
        {/* Faint guides at 6a, 12p and 6p behind the rows. */}
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-11 right-0">
          {[6, 12, 18].map((h) => (
            <span key={h} className="absolute inset-y-0 w-px bg-[var(--border)] opacity-60" style={{ left: pct(h * 60) }} />
          ))}
        </div>
        <div className="space-y-2">
          {week.map((spans, day) => (
            <div key={day} className="flex items-center gap-3">
              <span
                className={`w-8 shrink-0 text-xs ${day === today ? "font-semibold text-[var(--accent)]" : "text-[var(--text-muted)]"}`}
              >
                {DAY_LABELS[day]}
              </span>
              <div
                className={`relative h-3.5 flex-1 overflow-hidden rounded-full ${
                  day === today ? "bg-[color-mix(in_srgb,var(--surface-2)_70%,var(--text-muted))]" : "bg-[var(--surface-2)]"
                }`}
              >
                {spans.map(([start, end], i) => (
                  <div
                    key={i}
                    // Square ends; the track rounds the day's edges, so a window
                    // crossing midnight reads as one piece.
                    className="absolute inset-y-0 rounded-[3px] bg-[var(--accent)]"
                    style={{ left: pct(start), width: pct(end - start), opacity: day === today ? 1 : 0.7 }}
                  />
                ))}
                {day === today && (
                  <div
                    className="absolute inset-y-0 w-0.5 bg-[var(--text-primary)] shadow-[0_0_0_2px_var(--surface-1)]"
                    style={{ left: pct(nowMinutes) }}
                    title="Now"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="relative ml-11 mt-2 h-4 text-[10px] text-[var(--text-muted)]">
        {[0, 6, 12, 18, 24].map((h) => (
          <span
            key={h}
            className="absolute"
            style={{ left: pct(h * 60), transform: `translateX(${h === 0 ? "0" : h === 24 ? "-100%" : "-50%"})` }}
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
  return `${twelve}${hour < 12 ? "a" : "p"}`;
}
