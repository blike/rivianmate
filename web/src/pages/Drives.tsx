import type { DriveDetailDto, DriveDto, DrivePlaceDto } from "@server/api-types.js";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client.js";
import { useUnits } from "../api/hooks.js";
import { ContentFrame, LoadingScope, Skeleton, SkeletonBlock, SkeletonRows, useLoading } from "../components/loading.js";
import { Panel } from "../components/panels.js";
import { RecordPicker } from "../components/RecordPicker.js";
import { TrendChart } from "../components/TrendChart.js";
import { VehicleMap } from "../components/VehicleMap.js";
import { averageSpeedKmh, driveProfile, drivesByDay, minuteTicks, profilePosition, rangeUsedKm } from "../lib/drives.js";
import { isPosition } from "../lib/geo.js";
import { fmt, fmtDuration, fmtSeconds, titleCase } from "../lib/state.js";

/** A drive in progress refreshes this often, so its figures keep up. */
const LIVE_REFRESH_MS = 15_000;

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const longDay = (iso: string) =>
  new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });

/** Battery % used; null when unknown or too small to show. */
const batteryUsed = (d: Pick<DriveDto, "startBattery" | "endBattery">) => {
  const used = d.startBattery != null && d.endBattery != null ? d.startBattery - d.endBattery : null;
  return used != null && Math.abs(used) >= 0.05 ? used : null;
};

/** Battery change as a signed percent: "−6.3%", or "+1.2%" if it rose (e.g. regen downhill). */
const batteryChange = (used: number) => `${used > 0 ? "−" : "+"}${fmt(Math.abs(used), 1)}%`;

/** "2101 Ireland Grove Road, Bloomington" → "2101 Ireland Grove Road", for tight rows. */
const shortPlace = (label: string) => label.split(",")[0]!.trim();

export function Drives(props: { vehicleId: string }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const u = useUnits();

  const { data: drives, isPending: drivesPending } = useQuery({
    queryKey: ["drives", props.vehicleId],
    queryFn: () => api.drives(props.vehicleId),
    refetchInterval: (query) => (query.state.data?.some((d) => !d.endedAt) ? LIVE_REFRESH_MS : 60_000),
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
    () => (detail?.points ?? []).filter((p) => isPosition(p.lat, p.lon)).map((p) => [p.lat, p.lon] as [number, number]),
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
            lat: p.lat,
            lon: p.lon,
          }))
        : [],
    [detail, u],
  );
  // The chart point under the pointer, marked on the route map.
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const hoverPosition = hoverIndex != null ? profilePosition(profile, hoverIndex) : null;

  if (!drivesPending && !drives?.length) {
    return (
      <Panel title="Drives">
        <p className="py-6 text-center text-sm text-[var(--text-muted)]">No drives recorded yet.</p>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      {drives && drives.length > 1 && (
        <DrivePicker drives={drives} selectedId={driveId} onSelect={setSelectedId} />
      )}
      <div className={`transition-opacity ${showingPreviousDrive ? "opacity-50" : ""}`}>
        <LoadingScope loading={loading}>
          <DriveCard drive={detail} />
        </LoadingScope>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Route" className={`flex flex-col transition-opacity ${showingPreviousDrive ? "opacity-50" : ""}`}>
          <div className="relative h-[22rem] overflow-hidden rounded-lg lg:h-[26rem]">
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
                  highlight={hoverPosition}
                />
              </div>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
                No GPS from the vehicle during this drive (it may have had no signal).
              </p>
            )}
          </div>
          <div className="mt-4">
            <ContentFrame
              height={150}
              loading={loading}
              empty={profile.length < 2}
              emptyText="No speed or altitude readings for this drive."
            >
              <TrendChart
                data={profile}
                xKey="minutes"
                height={150}
                onHover={setHoverIndex}
                xTicks={minuteTicks(profile[0]?.minutes ?? 0, profile.at(-1)?.minutes ?? 0)}
                xFormatter={formatMinutes(profile.at(-1)?.minutes ?? 0)}
                tooltipLabel={detail ? tooltipTime(detail.startedAt) : undefined}
                series={[
                  { key: "speed", label: "Speed", color: "var(--accent)", unit: u.speedUnit, digits: 0 },
                  { key: "elevation", label: "Elevation", color: "var(--series-1)", mark: "line", right: true, unit: u.elevationUnit, digits: 0 },
                ]}
              />
            </ContentFrame>
          </div>
        </Panel>

        <Panel title="All drives" className="hidden flex-col lg:flex">
          <div className="relative min-h-0 flex-1">
            <div className="-mx-4 max-h-[28rem] overflow-auto lg:absolute lg:inset-0 lg:max-h-none">
              {drivesPending ? (
                <div className="px-4">
                  <SkeletonRows rows={8} />
                </div>
              ) : (
                <DriveList drives={drives!} selectedId={driveId} onSelect={setSelectedId} />
              )}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/** The chosen drive: where it went up front, then its figures. */
function DriveCard(props: { drive: DriveDetailDto | undefined }) {
  const u = useUnits();
  const loading = useLoading();
  const d = props.drive;
  const live = d != null && !d.endedAt;
  const used = d ? batteryUsed(d) : null;
  const rangeUsed = d ? rangeUsedKm(d.startRangeKm, d.endRangeKm) : null;
  const avgSpeed = d ? averageSpeedKmh(d.distanceKm, d.startedAt, d.endedAt) : null;
  const to = d?.end?.label ?? (live && d?.destination?.name ? `Navigating to ${d.destination.name}` : null);

  const tiles: { label: string; value: ReactNode; sub?: ReactNode }[] = [
    { label: "Distance", value: u.formatDistance(d?.distanceKm, 1) },
    {
      label: "Duration",
      value: d ? fmtDuration(d.startedAt, d.endedAt) : "—",
      sub: avgSpeed != null ? `${u.formatSpeed(avgSpeed)} average` : undefined,
    },
    {
      label: "Efficiency",
      value: u.formatEfficiency(d?.distanceKm, d?.energyKwh),
      sub: d?.energyKwh != null ? `${fmt(d.energyKwh, 1)} kWh used` : undefined,
    },
    {
      label: "Battery",
      value: d?.startBattery != null && d.endBattery != null ? `${fmt(d.startBattery, 0)}% → ${fmt(d.endBattery, 0)}%` : "—",
      sub:
        used != null
          ? `${batteryChange(used)}${rangeUsed != null ? ` · ${u.formatDistance(rangeUsed)} of range` : ""}`
          : undefined,
    },
    {
      label: "Top speed",
      value: u.formatSpeed(d?.maxSpeedKmh),
      sub: d?.driveMode ? `${titleCase(d.driveMode)} mode` : undefined,
    },
    {
      label: "Elevation",
      value:
        d?.elevationGainM != null || d?.elevationLossM != null
          ? `↑ ${u.formatElevation(d?.elevationGainM)}`
          : "—",
      sub: d?.elevationLossM != null ? `↓ ${u.formatElevation(d.elevationLossM)}` : undefined,
    },
  ];

  return (
    <section className="card overflow-hidden">
      <div className="p-5">
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          {loading || !d ? (
            <Skeleton className="w-[14em]" />
          ) : (
            <>
              {live && (
                <span className="flex items-center gap-1.5 font-medium uppercase tracking-wide text-[var(--status-good)]">
                  <span className="chip-dot--pulse h-1.5 w-1.5 rounded-full bg-[var(--status-good)] text-[var(--status-good)]" />
                  In progress
                </span>
              )}
              <span>
                {longDay(d.startedAt)} · {clock(d.startedAt)}
                {d.endedAt && ` – ${clock(d.endedAt)}`}
              </span>
            </>
          )}
        </div>
        <h2 className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 text-xl font-semibold tracking-tight">
          {loading || !d ? (
            <Skeleton className="w-[16em]" />
          ) : (
            <>
              <Place place={d.start} />
              <span aria-label="to" className="text-[var(--text-muted)]">
                →
              </span>
              {d.end ? <Place place={d.end} /> : <span className="text-[var(--text-secondary)]">{to ?? (live ? "…" : "—")}</span>}
            </>
          )}
        </h2>
      </div>
      <ul className="grid grid-cols-2 gap-px border-t border-[var(--border)] bg-[var(--border)] sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <li key={t.label} className="bg-[var(--surface-1)] px-4 py-3">
            <div className="text-xs text-[var(--text-muted)]">{t.label}</div>
            <div className="mt-1 text-base font-semibold tabular-nums">{loading ? <Skeleton className="w-[5em]" /> : t.value}</div>
            <div className="truncate text-xs text-[var(--text-secondary)]">
              {loading ? <Skeleton className="w-[7em]" /> : (t.sub ?? " ")}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Home" or a short address, with the full address on hover. */
function Place(props: { place: DrivePlaceDto | null }) {
  if (!props.place) return <span className="text-[var(--text-muted)]">Unknown</span>;
  return (
    <span className="min-w-0 truncate" title={props.place.address ?? props.place.label}>
      {props.place.isHome && <HomeIcon />}
      {props.place.label}
    </span>
  );
}

/** On narrow screens, a picker up top stands in for the list. */
function DrivePicker(props: { drives: DriveDto[]; selectedId: number | null; onSelect: (id: number) => void }) {
  const u = useUnits();
  const groups = useMemo(
    () =>
      drivesByDay(props.drives).map((day) => ({
        key: day.key,
        label: day.label,
        items: day.drives.map((d) => ({
          id: d.id,
          label: `${clock(d.startedAt)} · ${d.start ? shortPlace(d.start.label) : "—"} → ${destination(d)} · ${u.formatDistance(d.distanceKm, 1)}`,
        })),
      })),
    [props.drives, u],
  );
  return (
    <RecordPicker
      label="Drive"
      groups={groups}
      selectedId={props.selectedId}
      onSelect={props.onSelect}
      className="sticky top-2 z-20 lg:hidden"
    />
  );
}

/** Where a drive ended, or where it's headed while under way. */
function destination(d: DriveDto): string {
  if (d.endedAt) return d.end ? shortPlace(d.end.label) : "—";
  return d.destination?.name ? `Navigating to ${d.destination.name}` : "…";
}

/** Drives by day, newest first, each day with its total. */
function DriveList(props: { drives: DriveDto[]; selectedId: number | null; onSelect: (id: number) => void }) {
  const u = useUnits();
  const days = useMemo(() => drivesByDay(props.drives), [props.drives]);
  return (
    <div>
      {days.map((day) => (
        <section key={day.key}>
          <h4 className="sticky top-0 z-10 flex items-baseline justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-1)] px-4 py-2 text-xs">
            <span className="font-medium uppercase tracking-wide text-[var(--text-muted)]">{day.label}</span>
            <span className="tabular-nums text-[var(--text-muted)]">
              {day.drives.length} drive{day.drives.length === 1 ? "" : "s"} · {u.formatDistance(day.distanceKm)}
            </span>
          </h4>
          <ul>
            {day.drives.map((d) => (
              <DriveItem key={d.id} drive={d} selected={props.selectedId === d.id} onSelect={() => props.onSelect(d.id)} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DriveItem(props: { drive: DriveDto; selected: boolean; onSelect: () => void }) {
  const u = useUnits();
  const d = props.drive;
  const used = batteryUsed(d);
  const to = destination(d);
  const facts = [
    fmtDuration(d.startedAt, d.endedAt),
    used != null && batteryChange(used),
    d.energyKwh != null && u.formatEfficiency(d.distanceKm, d.energyKwh),
  ].filter(Boolean);

  return (
    <li>
      <button
        onClick={props.onSelect}
        aria-current={props.selected ? "true" : undefined}
        className={`relative grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-2)] ${
          props.selected ? "bg-[var(--surface-2)]" : ""
        }`}
      >
        {props.selected && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-[var(--accent)]" />}
        <span className="text-xs tabular-nums text-[var(--text-muted)]">{clock(d.startedAt)}</span>
        <span className="min-w-0">
          <span className="block truncate text-sm" title={`${d.start?.address ?? d.start?.label ?? "—"} → ${d.end?.address ?? to}`}>
            <span className={d.start?.isHome ? "font-medium" : ""}>{d.start ? shortPlace(d.start.label) : "—"}</span>
            <span className="text-[var(--text-muted)]"> → </span>
            <span className={d.end?.isHome ? "font-medium" : ""}>{to}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs tabular-nums text-[var(--text-muted)]">
            {!d.endedAt && <span className="mr-1.5 text-[var(--status-good)]">In progress ·</span>}
            {facts.join(" · ")}
          </span>
        </span>
        <span className="text-sm font-medium tabular-nums">{u.formatDistance(d.distanceKm, 1)}</span>
      </button>
    </li>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 16 16" className="mr-1.5 inline h-[0.85em] w-[0.85em] -translate-y-px text-[var(--accent)]" fill="currentColor" aria-hidden>
      <path d="M8 1.5 1 7.2l.9 1.1L3 7.4V14h4v-4h2v4h4V7.4l1.1.9.9-1.1L8 1.5Z" />
    </svg>
  );
}

/** Axis labels for whole minutes into a drive: "25 min", or "1h 30m" style for drives of two hours or more. */
function formatMinutes(totalMinutes: number) {
  return (m: number) => (totalMinutes >= 120 ? fmtSeconds(m * 60) : `${fmt(m, 0)} min`);
}

/** "47m (12:52 PM)": time into the drive, then the time of day. */
function tooltipTime(startedAt: string) {
  const start = Date.parse(startedAt);
  return (m: number) => {
    const at = new Date(start + m * 60_000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return `${fmtSeconds(m * 60)} (${at})`;
  };
}
