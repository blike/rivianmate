import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { useUnits } from "../api/hooks.js";
import { formatDuration, formatSeatLevel, formatTimeOfDay, formatWeekDays } from "../lib/schedules.js";
import { fmt } from "../lib/state.js";
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
            <ul className="space-y-2 text-sm">
              {charging.map((c, i) => (
                <li key={i} className="rounded-md bg-[var(--surface-2)] p-3">
                  <div className="font-medium">
                    {formatTimeOfDay(c.startTime)} for {formatDuration(c.duration)}
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">
                    {formatWeekDays(c.weekDays)}
                    {c.amperage != null && ` · ${fmt(c.amperage, 0)} A`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="min-w-0">
          <h3 className="mb-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">Departures</h3>
          {isPending ? (
            <ScheduleSkeleton />
          ) : data?.departuresUnavailable ? (
            <p className="text-sm text-[var(--text-muted)]">Rivian doesn't provide departure schedules for this vehicle.</p>
          ) : departures == null ? (
            <p className="text-sm text-[var(--text-muted)]">Waiting for the vehicle to report its schedules.</p>
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
