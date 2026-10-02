import type { ChargingSchedule } from "@server/api-types.js";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useUnits } from "../api/hooks.js";
import {
  dayLabel,
  formatSeatLevel,
  formatTimeOfDay,
  formatTimeRange,
  formatWeekDays,
  kwAt240V,
  scheduleStatus,
  weekSpans,
} from "../lib/schedules.js";
import { fmt, fmtSeconds } from "../lib/state.js";
import { SkeletonBlock } from "./loading.js";
import { Panel } from "./panels.js";

/** Same height as one schedule card. */
function ScheduleSkeleton() {
  return <SkeletonBlock height="4rem" />;
}

/**
 * Read-only view of the charging and departure schedules set in the Rivian
 * app. Schedules switched off are left out; Rivian returns those too.
 */
export function SchedulesPanel(props: { vehicleId: string; className?: string }) {
  const u = useUnits();
  const { data, isPending } = useQuery({
    queryKey: ["schedules", props.vehicleId],
    queryFn: () => api.schedules(props.vehicleId),
    refetchInterval: 5 * 60_000,
  });
  const charging = data?.charging?.filter((c) => c.enabled !== false);
  const departures = data?.departures?.filter((d) => d.enabled !== false);

  return (
    <Panel title="Schedules" className={props.className}>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-1">
        <section className="min-w-0">
          <h3 className="mb-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">Charging</h3>
          {isPending ? (
            <ScheduleSkeleton />
          ) : charging == null ? (
            <p className="text-sm text-[var(--text-muted)]">Not loaded yet.</p>
          ) : charging.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No charging schedule on.</p>
          ) : (
            <ChargingWeek schedules={charging} />
          )}
        </section>

        <section className="min-w-0">
          <h3 className="mb-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">Departures</h3>
          {isPending ? (
            <ScheduleSkeleton />
          ) : data?.departuresUnavailable ? (
            <p className="text-sm text-[var(--text-muted)]">Rivian doesn't provide departure schedules for this vehicle.</p>
          ) : departures == null ? (
            <p className="text-sm text-[var(--text-muted)]">No departure schedules reported.</p>
          ) : departures.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No departure schedule on.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {departures.map((d) => (
                <li key={d.id} className="rounded-md bg-[var(--surface-2)] p-3">
                  <div className="font-medium">
                    {d.name ?? "Departure"} · {formatTimeOfDay(d.occurrence?.timeOfDayMinutes)}
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">
                    {formatWeekDays(d.occurrence?.weekDays)}
                    {d.comfortSettings?.cabinClimateSetTemp != null &&
                      ` · Cabin ${u.formatTemperature(d.comfortSettings.cabinClimateSetTemp)}`}
                    {d.comfortSettings?.seatFrontLeftHeat != null &&
                      ` · Driver seat ${formatSeatLevel(d.comfortSettings.seatFrontLeftHeat)}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Panel>
  );
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pct = (minutes: number) => `${(minutes / 1440) * 100}%`;

/** Charging windows across the week, with what's open now and what's next. */
function ChargingWeek(props: { schedules: ChargingSchedule[] }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const week = weekSpans(props.schedules);
  const status = scheduleStatus(props.schedules, now);
  const today = (now.getDay() + 6) % 7;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="space-y-4">
      {status && (
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${status.open ? "chip-dot--pulse" : ""}`}
            style={{ background: status.open ? "var(--accent)" : "var(--text-muted)", color: "var(--accent)" }}
          />
          {status.open ? (
            <span>
              Charging window open · ends {formatClock(status.endsAt)}
              <span className="text-[var(--text-muted)]"> (in {fmtSeconds((status.endsAt.getTime() - now.getTime()) / 1000)})</span>
            </span>
          ) : (
            <span>
              Next window {dayLabel(status.startsAt, now)} at {formatClock(status.startsAt)}
              <span className="text-[var(--text-muted)]"> (in {fmtSeconds((status.startsAt.getTime() - now.getTime()) / 1000)})</span>
            </span>
          )}
        </div>
      )}

      <div role="img" aria-label={props.schedules.map((c) => `${formatWeekDays(c.weekDays)} ${formatTimeRange(c.startTime, c.duration)}`).join("; ")}>
        <div className="space-y-1.5">
          {week.map((spans, day) => (
            <div key={day} className="flex items-center gap-3">
              <span
                className={`w-8 shrink-0 text-xs ${day === today ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}
              >
                {DAY_LABELS[day]}
              </span>
              <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                {spans.map(([start, end], i) => (
                  <div
                    key={i}
                    // Square ends; the track rounds the day's edges, so a window
                    // crossing midnight reads as one piece.
                    className="absolute inset-y-0 rounded-[3px]"
                    style={{
                      left: pct(start),
                      width: pct(end - start),
                      background: "color-mix(in srgb, var(--accent) 75%, transparent)",
                    }}
                  />
                ))}
                {day === today && (
                  <div
                    className="absolute -inset-y-0.5 w-0.5 rounded-full bg-[var(--text-primary)]"
                    style={{ left: pct(nowMinutes) }}
                    title="Now"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="relative ml-11 mt-1 h-4 text-[10px] text-[var(--text-muted)]">
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

      <ul className="space-y-1 text-sm">
        {props.schedules.map((c, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">
              <span className="text-[var(--text-secondary)]">{formatWeekDays(c.weekDays)}</span>{" "}
              <span className="tabular-nums">{formatTimeRange(c.startTime, c.duration)}</span>
            </span>
            {c.amperage != null && (
              <span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">
                {fmt(c.amperage, 0)} A · ~{fmt(kwAt240V(c.amperage), 1)} kW
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const formatClock = (d: Date) => formatTimeOfDay(d.getHours() * 60 + d.getMinutes());

/** Axis labels: "12a", "6a", "12p", "6p". */
function hourLabel(h: number): string {
  const hour = h % 24;
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${hour < 12 ? "a" : "p"}`;
}
