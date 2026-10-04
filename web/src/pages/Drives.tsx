import type { DriveDetailDto, DriveDto, DrivePlaceDto } from "@server/api-types.js";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useUnits } from "../api/hooks.js";
import { ContentFrame, LoadingScope, Skeleton, SkeletonBlock, SkeletonRows } from "../components/loading.js";
import { Panel, Row } from "../components/panels.js";
import { TrendChart } from "../components/TrendChart.js";
import { VehicleMap } from "../components/VehicleMap.js";
import { averageSpeedKmh, driveProfile, rangeUsedKm } from "../lib/drives.js";
import { isPosition } from "../lib/geo.js";
import { fmt, fmtDuration, fmtSeconds, titleCase } from "../lib/state.js";
import { useRemainingHeight } from "../lib/useRemainingHeight.js";

/** A drive in progress refreshes this often, so its figures keep up. */
const LIVE_REFRESH_MS = 15_000;

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function Drives(props: { vehicleId: string }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const u = useUnits();

  const { data: drives, isPending: drivesPending } = useQuery({
    queryKey: ["drives", props.vehicleId],
    queryFn: () => api.drives(props.vehicleId),
    refetchInterval: (query) =>
      query.state.data?.some((d) => !d.endedAt) ? LIVE_REFRESH_MS : 60_000,
  });
  // The newest drive until one is picked.
  const driveId = selectedId ?? drives?.[0]?.id ?? null;

  const {
    data: detail,
    isPending: detailPending,
    isPlaceholderData: showingPreviousDrive,
  } = useQuery({
    queryKey: ["drive", driveId],
    queryFn: () => api.drive(driveId!),
    enabled: driveId != null,
    refetchInterval: (query) => (query.state.data && !query.state.data.endedAt ? LIVE_REFRESH_MS : false),
    // Keep the previous drive on screen (dimmed) while the next one loads.
    placeholderData: keepPreviousData,
  });
  const loading = drivesPending || (driveId != null && detailPending);

  const trail = useMemo(
    () =>
      (detail?.points ?? [])
        .filter((p) => isPosition(p.lat, p.lon))
        .map((p) => [p.lat, p.lon] as [number, number]),
    [detail],
  );
  const lastPoint = trail.at(-1);

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

  // The drives table fills the rest of the screen and scrolls inside; the
  // gap leaves room for the panel's padding and the page's bottom margin.
  const tableRef = useRef<HTMLDivElement>(null);
  const tableHeight = useRemainingHeight(tableRef, 58, 0.4);

  if (!drivesPending && !drives?.length) {
    return (
      <Panel title="Drives">
        <p className="py-6 text-center text-sm text-[var(--text-muted)]">No drives recorded yet.</p>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      {/* The map stretches to the stats column's height. */}
      <div
        className={`grid grid-cols-1 gap-4 transition-opacity lg:grid-cols-2 ${
          showingPreviousDrive ? "opacity-50" : ""
        }`}
      >
        <div className="flex flex-col gap-4">
          <Panel title={detail && !detail.endedAt ? "Drive · In progress" : "Drive"} className="flex-1">
            <LoadingScope loading={loading}>
              <DriveSummary drive={detail} loading={loading} />
            </LoadingScope>
          </Panel>
          <Panel title="Speed and elevation">
            <ContentFrame
              height={160}
              loading={loading}
              empty={profile.length < 2}
              emptyText="No speed or altitude readings for this drive."
            >
              <TrendChart
                data={profile}
                xKey="minutes"
                height={160}
                xFormatter={formatMinutes(profile.at(-1)?.minutes ?? 0)}
                series={[
                  { key: "speed", label: "Speed", color: "var(--series-1)", unit: u.speedUnit, digits: 0 },
                  { key: "elevation", label: "Elevation", color: "var(--series-2)", mark: "line", right: true, unit: u.elevationUnit, digits: 0 },
                ]}
              />
            </ContentFrame>
          </Panel>
        </div>

        <Panel title="Route" className="flex min-h-[22rem] flex-col">
          <div className="relative min-h-[18rem] flex-1 overflow-hidden rounded-lg">
            {loading ? (
              <SkeletonBlock height="100%" />
            ) : detail && lastPoint ? (
              <div className="absolute inset-0">
                <VehicleMap
                  key={detail.id}
                  lat={lastPoint[0]}
                  lon={lastPoint[1]}
                  trail={trail}
                  height="100%"
                  follow={false}
                />
              </div>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
                No GPS from the vehicle during this drive (it may have had no signal).
              </p>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Drives">
        <div ref={tableRef} className="overflow-auto" style={{ maxHeight: tableHeight }}>
          {drivesPending ? (
            <SkeletonRows rows={8} />
          ) : (
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="sticky top-0 z-10 bg-[var(--surface-1)] text-left text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="pb-2 font-normal">Started</th>
                  <th className="pb-2 font-normal">From</th>
                  <th className="pb-2 font-normal">To</th>
                  <th className="pb-2 font-normal">Duration</th>
                  <th className="pb-2 text-right font-normal">Distance</th>
                  <th className="pb-2 text-right font-normal">Battery</th>
                  <th className="pb-2 text-right font-normal">Efficiency</th>
                </tr>
              </thead>
              <tbody>
                {drives!.map((d) => (
                  <DriveRow key={d.id} drive={d} selected={driveId === d.id} onSelect={() => setSelectedId(d.id)} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Panel>
    </div>
  );
}

function DriveRow(props: { drive: DriveDto; selected: boolean; onSelect: () => void }) {
  const u = useUnits();
  const d = props.drive;
  const used = d.startBattery != null && d.endBattery != null ? d.startBattery - d.endBattery : null;
  return (
    <tr
      onClick={props.onSelect}
      className={`cursor-pointer border-t border-[var(--border)] hover:bg-[var(--surface-2)] ${
        props.selected ? "bg-[var(--surface-2)]" : ""
      }`}
    >
      <td className="whitespace-nowrap py-2 pr-3">
        {dateTime(d.startedAt)}
        {!d.endedAt && <span className="ml-2 text-xs text-[var(--status-good)]">In progress</span>}
      </td>
      <td className="py-2 pr-3">
        <PlaceCell place={d.start} />
      </td>
      <td className="py-2 pr-3">
        {d.endedAt ? (
          <PlaceCell place={d.end} />
        ) : d.destination?.name ? (
          <span className="block max-w-[14rem] truncate text-[var(--text-secondary)]" title={d.destination.name}>
            Navigating to {d.destination.name}
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        )}
      </td>
      <td className="whitespace-nowrap py-2">{fmtDuration(d.startedAt, d.endedAt)}</td>
      <td className="py-2 text-right tabular-nums">{u.formatDistance(d.distanceKm, 1)}</td>
      <td className="py-2 text-right tabular-nums">{used != null ? `-${fmt(used, 1)}%` : "—"}</td>
      <td className="py-2 text-right tabular-nums">{u.formatEfficiency(d.distanceKm, d.energyKwh)}</td>
    </tr>
  );
}

/** "Home" or a short address (full address on hover); "—" until looked up. */
function PlaceCell(props: { place: DrivePlaceDto | null }) {
  if (!props.place) return <span className="text-[var(--text-muted)]">—</span>;
  return (
    <span
      className={`block max-w-[14rem] truncate ${props.place.isHome ? "font-medium" : ""}`}
      title={props.place.address ?? props.place.label}
    >
      {props.place.label}
    </span>
  );
}

/** Axis labels for minutes into a drive, with decimals for short ones so ticks don't repeat. */
function formatMinutes(totalMinutes: number) {
  return (m: number) =>
    totalMinutes >= 120 ? fmtSeconds(m * 60) : `${fmt(m, totalMinutes < 10 ? 1 : 0)} min`;
}

/** When and where, then the drive's figures; for a drive in progress, its readings so far. */
function DriveSummary(props: { drive: DriveDetailDto | undefined; loading: boolean }) {
  const u = useUnits();
  const d = props.drive;
  const live = d != null && !d.endedAt;
  const rangeUsed = d ? rangeUsedKm(d.startRangeKm, d.endRangeKm) : null;
  const battery =
    d?.startBattery != null && d.endBattery != null
      ? `${fmt(d.startBattery, 0)}% → ${fmt(d.endBattery, 0)}%`
      : "—";
  const to = d?.end?.label ?? (live && d?.destination?.name ? `Navigating to ${d.destination.name}` : null);

  return (
    <div>
      <div className="mb-3">
        <p className="text-sm font-medium">
          {props.loading || !d ? <Skeleton className="w-[12em]" /> : dateTime(d.startedAt)}
        </p>
        <p className="truncate text-sm text-[var(--text-secondary)]">
          {props.loading || !d ? (
            <Skeleton className="w-[16em]" />
          ) : (
            <>
              {d.start?.label ?? "—"} → {to ?? (live ? "…" : "—")}
            </>
          )}
        </p>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <Row label="Distance" value={u.formatDistance(d?.distanceKm, 1)} />
        <Row label="Duration" value={d ? fmtDuration(d.startedAt, d.endedAt) : "—"} />
        <Row label="Battery" value={battery} />
        <Row label="Energy" value={d?.energyKwh != null ? `${fmt(d.energyKwh, 1)} kWh` : "—"} />
        <Row label="Efficiency" value={u.formatEfficiency(d?.distanceKm, d?.energyKwh)} />
        <Row label="Range used" value={u.formatDistance(rangeUsed)} />
        <Row label="Avg speed" value={u.formatSpeed(d ? averageSpeedKmh(d.distanceKm, d.startedAt, d.endedAt) : null)} />
        <Row label="Top speed" value={u.formatSpeed(d?.maxSpeedKmh)} />
        <Row label="Climb" value={u.formatElevation(d?.elevationGainM)} />
        <Row label="Descent" value={u.formatElevation(d?.elevationLossM)} />
        <Row label="Drive mode" value={d?.driveMode ? titleCase(d.driveMode) : "—"} />
      </dl>
    </div>
  );
}
