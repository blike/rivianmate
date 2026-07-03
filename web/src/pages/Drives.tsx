import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client.js";
import { Panel } from "../components/panels.js";
import { VehicleMap } from "../components/VehicleMap.js";
import { fmt, fmtDuration, kmToMi } from "../lib/state.js";

export function Drives(props: { vehicleId: string }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: drives } = useQuery({
    queryKey: ["drives", props.vehicleId],
    queryFn: () => api.drives(props.vehicleId),
    refetchInterval: 60_000,
  });

  const { data: detail } = useQuery({
    queryKey: ["drive", selectedId],
    queryFn: () => api.drive(selectedId!),
    enabled: selectedId != null,
  });

  const trail = (detail?.points ?? []).map(
    (p) => [p.lat, p.lon] as [number, number],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Panel title="Drives">
        {!drives?.length ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">
            No drives recorded yet.
          </p>
        ) : (
          <div className="max-h-[32rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="pb-2 font-normal">Started</th>
                  <th className="pb-2 font-normal">Duration</th>
                  <th className="pb-2 text-right font-normal">Distance</th>
                  <th className="pb-2 text-right font-normal">Battery</th>
                </tr>
              </thead>
              <tbody>
                {drives.map((d) => {
                  const used =
                    d.startBattery != null && d.endBattery != null
                      ? d.startBattery - d.endBattery
                      : null;
                  return (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedId(d.id)}
                      className={`cursor-pointer border-t border-[var(--border)] hover:bg-[var(--surface-2)] ${
                        selectedId === d.id ? "bg-[var(--surface-2)]" : ""
                      }`}
                    >
                      <td className="py-2">
                        {new Date(d.startedAt).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {!d.endedAt && (
                          <span className="ml-2 text-xs text-[var(--status-good)]">
                            in progress
                          </span>
                        )}
                      </td>
                      <td className="py-2">{fmtDuration(d.startedAt, d.endedAt)}</td>
                      <td className="py-2 text-right tabular-nums">
                        {d.distanceKm != null
                          ? `${fmt(kmToMi(d.distanceKm), 1)} mi`
                          : "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {used != null ? `-${fmt(used, 1)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Route">
        {detail && trail.length > 0 ? (
          <VehicleMap
            lat={trail[Math.floor(trail.length / 2)]![0]}
            lon={trail[Math.floor(trail.length / 2)]![1]}
            trail={trail}
            height="28rem"
            follow={false}
          />
        ) : (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">
            Select a drive to see its route.
          </p>
        )}
      </Panel>
    </div>
  );
}
