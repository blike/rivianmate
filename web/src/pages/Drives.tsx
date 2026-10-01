import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useUnits } from "../api/hooks.js";
import { ContentFrame, LoadingScope, SkeletonRows } from "../components/loading.js";
import { Panel, Row } from "../components/panels.js";
import { TrendChart } from "../components/TrendChart.js";
import { withCumulativeKm } from "../lib/geo.js";
import { VehicleMap } from "../components/VehicleMap.js";
import { fmt, fmtDuration } from "../lib/state.js";

export function Drives(props: { vehicleId: string }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const u = useUnits();

  const { data: drives, isPending: drivesPending } = useQuery({
    queryKey: ["drives", props.vehicleId],
    queryFn: () => api.drives(props.vehicleId),
    refetchInterval: 60_000,
  });

  const {
    data: detail,
    isPending: detailPending,
    isPlaceholderData: showingPreviousDrive,
  } = useQuery({
    queryKey: ["drive", selectedId],
    queryFn: () => api.drive(selectedId!),
    enabled: selectedId != null,
    // Keep the previous route on screen (dimmed) while the next one loads.
    placeholderData: keepPreviousData,
  });

  const trail = (detail?.points ?? []).map(
    (p) => [p.lat, p.lon] as [number, number],
  );
  const midpoint = trail[Math.floor(trail.length / 2)];

  const profile = useMemo(
    () =>
      withCumulativeKm(detail?.points ?? [])
        .filter((p) => p.altitude != null)
        .map((p) => ({ x: u.distance(p.km) ?? 0, elevation: u.elevation(p.altitude) })),
    [detail, u],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Panel title="Drives">
        {drivesPending ? (
          <SkeletonRows rows={8} />
        ) : !drives?.length ? (
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
                  <th className="pb-2 text-right font-normal">Efficiency</th>
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
                        {u.formatDistance(d.distanceKm, 1)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {used != null ? `-${fmt(used, 1)}%` : "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {u.formatEfficiency(d.distanceKm, d.energyKwh)}
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
        {selectedId == null ? (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">
            Select a drive to see its route.
          </p>
        ) : (
          <div className={`transition-opacity ${showingPreviousDrive ? "opacity-50" : ""}`}>
            <LoadingScope loading={detailPending}>
              <dl className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                <Row label="Distance" value={u.formatDistance(detail?.distanceKm, 1)} />
                <Row label="Energy" value={detail?.energyKwh != null ? `${fmt(detail.energyKwh, 1)} kWh` : "—"} />
                <Row label="Efficiency" value={u.formatEfficiency(detail?.distanceKm, detail?.energyKwh)} />
                <Row label="Climb" value={u.formatElevation(detail?.elevationGainM)} />
                <Row label="Descent" value={u.formatElevation(detail?.elevationLossM)} />
                <Row label="Duration" value={detail ? fmtDuration(detail.startedAt, detail.endedAt) : "—"} />
              </dl>
            </LoadingScope>
            <ContentFrame
              height="28rem"
              loading={detailPending}
              empty={!midpoint}
              emptyText="No GPS points recorded for this drive."
            >
              {detail && midpoint && (
                <VehicleMap
                  key={detail.id}
                  lat={midpoint[0]}
                  lon={midpoint[1]}
                  trail={trail}
                  height="28rem"
                  follow={false}
                />
              )}
            </ContentFrame>
          </div>
        )}
        {profile.length > 1 && (
          <div className="mt-4">
            <h3 className="mb-1 text-xs text-[var(--text-muted)]">Elevation ({u.elevationUnit})</h3>
            <TrendChart
              data={profile}
              xKey="x"
              height={160}
              xFormatter={(x) => `${fmt(x, 1)} ${u.distanceUnit}`}
              series={[{ key: "elevation", label: "Elevation", color: "var(--series-2)", unit: u.elevationUnit, digits: 0 }]}
            />
          </div>
        )}
      </Panel>
    </div>
  );
}
