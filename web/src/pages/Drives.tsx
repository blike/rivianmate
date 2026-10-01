import type { DriveDetailDto } from "@server/api-types.js";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useUnits } from "../api/hooks.js";
import { ContentFrame, LoadingScope, SkeletonRows } from "../components/loading.js";
import { Panel, Row } from "../components/panels.js";
import { TrendChart } from "../components/TrendChart.js";
import { VehicleMap } from "../components/VehicleMap.js";
import { averageSpeedKmh, driveProfile, rangeUsedKm } from "../lib/drives.js";
import { fmt, fmtDuration, titleCase } from "../lib/state.js";

/** A drive in progress refreshes this often, so its figures keep up. */
const LIVE_REFRESH_MS = 15_000;

const timeOfDay = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function Drives(props: { vehicleId: string }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const u = useUnits();

  const { data: drives, isPending: drivesPending } = useQuery({
    queryKey: ["drives", props.vehicleId],
    queryFn: () => api.drives(props.vehicleId),
    refetchInterval: (query) =>
      query.state.data?.some((d) => !d.endedAt) ? LIVE_REFRESH_MS : 60_000,
  });

  const {
    data: detail,
    isPending: detailPending,
    isPlaceholderData: showingPreviousDrive,
  } = useQuery({
    queryKey: ["drive", selectedId],
    queryFn: () => api.drive(selectedId!),
    enabled: selectedId != null,
    refetchInterval: (query) => (query.state.data && !query.state.data.endedAt ? LIVE_REFRESH_MS : false),
    // Keep the previous route on screen (dimmed) while the next one loads.
    placeholderData: keepPreviousData,
  });

  const trail = (detail?.points ?? []).map(
    (p) => [p.lat, p.lon] as [number, number],
  );
  const midpoint = trail[Math.floor(trail.length / 2)];

  const profile = useMemo(
    () =>
      detail
        ? driveProfile(detail.points, detail.startedAt).map((p) => ({
            minutes: p.minutes,
            speed: u.distance(p.speedKmh),
            elevation: u.elevation(p.altitudeM),
          }))
        : [],
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
              <thead className="sticky top-0 bg-[var(--surface-1)] text-left text-xs text-[var(--text-muted)]">
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
                        {d.destination?.name && (
                          <div className="max-w-[16rem] truncate text-xs text-[var(--text-muted)]">
                            To {d.destination.name}
                          </div>
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

      <Panel title={detail && !detail.endedAt ? "Route · in progress" : "Route"}>
        {selectedId == null ? (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">
            Select a drive to see its route.
          </p>
        ) : (
          <div className={`transition-opacity ${showingPreviousDrive ? "opacity-50" : ""}`}>
            <LoadingScope loading={detailPending}>
              <DriveStats drive={detail} />
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
            {detail && detail.gaps.length > 0 && (
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                No readings{" "}
                {detail.gaps.map((g) => `${timeOfDay(g.from)}–${timeOfDay(g.to)}`).join(", ")}, so the
                route is a straight line there. Distance and energy come from the vehicle and stay
                accurate.
              </p>
            )}
          </div>
        )}
        {profile.length > 1 && (
          <div className="mt-4">
            <h3 className="mb-1 text-xs text-[var(--text-muted)]">Speed and elevation</h3>
            <TrendChart
              data={profile}
              xKey="minutes"
              height={180}
              xFormatter={(m) => `${fmt(m, 0)} min`}
              series={[
                { key: "speed", label: "Speed", color: "var(--series-1)", unit: u.speedUnit, digits: 0 },
                { key: "elevation", label: "Elevation", color: "var(--series-2)", mark: "line", right: true, unit: u.elevationUnit, digits: 0 },
              ]}
            />
          </div>
        )}
      </Panel>
    </div>
  );
}

/** The drive's figures; for a drive in progress, its readings so far. */
function DriveStats(props: { drive: DriveDetailDto | undefined }) {
  const u = useUnits();
  const d = props.drive;
  const live = d != null && !d.endedAt;
  const rangeUsed = d ? rangeUsedKm(d.startRangeKm, d.endRangeKm) : null;
  const battery =
    d?.startBattery != null && d.endBattery != null
      ? `${fmt(d.startBattery, 0)}% → ${fmt(d.endBattery, 0)}%`
      : "—";

  return (
    <div className="mb-3">
      {d?.destination && (
        <p className="mb-2 truncate text-sm">
          <span className="text-[var(--text-secondary)]">{live ? "Navigating to" : "Navigated to"}</span>{" "}
          {d.destination.name ?? `${fmt(d.destination.lat, 4)}, ${fmt(d.destination.lon, 4)}`}
        </p>
      )}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <Row label="Distance" value={u.formatDistance(d?.distanceKm, 1)} />
        <Row label="Duration" value={d ? fmtDuration(d.startedAt, d.endedAt) : "—"} />
        <Row label="Battery" value={battery} />
        <Row label="Energy" value={d?.energyKwh != null ? `${fmt(d.energyKwh, 1)} kWh` : "—"} />
        <Row label="Efficiency" value={u.formatEfficiency(d?.distanceKm, d?.energyKwh)} />
        <Row label="Range used" value={u.formatDistance(rangeUsed)} />
        <Row label="Avg speed" value={u.formatSpeed(d ? averageSpeedKmh(d.distanceKm, d.startedAt, d.endedAt) : null)} />
        <Row label="Top speed" value={u.formatSpeed(d?.maxSpeedKmh)} />
        <Row label="Drive mode" value={d?.driveMode ? titleCase(d.driveMode) : "—"} />
        <Row label="Climb" value={u.formatElevation(d?.elevationGainM)} />
        <Row label="Descent" value={u.formatElevation(d?.elevationLossM)} />
      </dl>
      {live && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Figures so far; they update every few seconds until the drive ends.
        </p>
      )}
    </div>
  );
}
