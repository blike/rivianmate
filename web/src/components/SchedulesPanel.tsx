import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { useUnits } from "../api/hooks.js";
import { formatDuration, formatTimeOfDay, formatWeekDays } from "../lib/schedules.js";
import { fmt, titleCase } from "../lib/state.js";
import { Panel } from "./panels.js";

function EnabledPill(props: { enabled: boolean | null }) {
  if (props.enabled == null) return null;
  return (
    <span
      className={`rounded-full border px-2 text-xs ${
        props.enabled
          ? "border-[var(--status-good)] text-[var(--status-good)]"
          : "border-[var(--border)] text-[var(--text-muted)]"
      }`}
    >
      {props.enabled ? "On" : "Off"}
    </span>
  );
}

/** Read-only view of charging and departure schedules set in the Rivian app. */
export function SchedulesPanel(props: { vehicleId: string }) {
  const u = useUnits();
  const { data } = useQuery({
    queryKey: ["schedules", props.vehicleId],
    queryFn: () => api.schedules(props.vehicleId),
    refetchInterval: 5 * 60_000,
  });

  return (
    <Panel title="Schedules">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="min-w-0">
          <h3 className="mb-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">Charging</h3>
          {data?.charging == null ? (
            <p className="text-sm text-[var(--text-muted)]">Not loaded yet.</p>
          ) : data.charging.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No charging schedule set.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.charging.map((c, i) => (
                <li key={i} className="rounded-md bg-[var(--surface-2)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {formatTimeOfDay(c.startTime)} for {formatDuration(c.duration)}
                    </span>
                    <EnabledPill enabled={c.enabled} />
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
          {data?.departuresUnavailable ? (
            <p className="text-sm text-[var(--text-muted)]">Rivian doesn't provide departure schedules for this vehicle.</p>
          ) : data?.departures == null ? (
            <p className="text-sm text-[var(--text-muted)]">Waiting for the vehicle to report its schedules.</p>
          ) : data.departures.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No departure schedules set.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.departures.map((d) => (
                <li key={d.id} className="rounded-md bg-[var(--surface-2)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {d.name ?? "Departure"} · {formatTimeOfDay(d.occurrence?.timeOfDayMinutes)}
                    </span>
                    <EnabledPill enabled={d.enabled} />
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">
                    {formatWeekDays(d.occurrence?.weekDays)}
                    {d.comfortSettings?.cabinClimateSetTemp != null &&
                      ` · Cabin ${u.formatTemperature(d.comfortSettings.cabinClimateSetTemp)}`}
                    {d.comfortSettings?.seatFrontLeftHeat != null &&
                      ` · Driver seat ${titleCase(String(d.comfortSettings.seatFrontLeftHeat))}`}
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
