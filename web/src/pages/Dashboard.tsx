import type { ChargingSessionDto, DriveDto, VehicleDto, VehicleState } from "@server/api-types.js";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useLiveCharging, useUnits, useVehicleState } from "../api/hooks.js";
import { BatteryEnergyPanel, ConnectivityPanel, NavigationCard, ParkedEnergyPanel } from "../components/InsightsPanels.js";
import {
  ClimatePanel,
  ClosuresGrid,
  Panel,
  Row,
  TirePanel,
} from "../components/panels.js";
import { FreshnessBadge } from "../components/FreshnessBadge.js";
import { LoadingScope, Skeleton, SkeletonBlock, useLoading } from "../components/loading.js";
import { VehicleMap } from "../components/VehicleMap.js";
import { chargeOutlook, chargerLabel, chargingSecondsNow, formatMoney } from "../lib/charging.js";
import { locationIsBehind, relativeTime } from "../lib/freshness.js";
import { isPosition } from "../lib/geo.js";
import { softwareUpdate } from "../lib/ota.js";
import { fmt, fmtDuration, fmtSeconds, location, nv, sv, titleCase } from "../lib/state.js";
import { type ActivityKind, brakeFluidLabel, securitySummary, vehicleActivity } from "../lib/vehicleStatus.js";

export function Dashboard(props: { vehicleId: string; vehicle?: VehicleDto }) {
  const { data: state, isPending } = useVehicleState(props.vehicleId);
  const { data: insights, isPending: insightsPending } = useQuery({
    queryKey: ["insights", props.vehicleId],
    queryFn: () => api.insights(props.vehicleId),
    // Navigation progress changes by the second; other readings slowly.
    refetchInterval: (query) => (query.state.data?.navigation ? 15_000 : 60_000),
  });

  return (
    <div className="space-y-6">
      <LoadingScope loading={isPending}>
        <Hero vehicleId={props.vehicleId} vehicle={props.vehicle} state={state} />
      </LoadingScope>

      {insights?.navigation && <NavigationCard navigation={insights.navigation} />}

      <RecentActivity vehicleId={props.vehicleId} />

      <section>
        <SectionHeading>Vehicle details</SectionHeading>
        <LoadingScope loading={insightsPending}>
          <Panel title="Parked energy" className="mb-4">
            <ParkedEnergyPanel insights={insights} />
          </Panel>
        </LoadingScope>
        <LoadingScope loading={isPending}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Doors, closures & windows">
              <ClosuresGrid state={state} model={props.vehicle?.model} />
            </Panel>

            <Panel title="Tires">
              <TirePanel state={state} />
            </Panel>

            <Panel title="Climate">
              <ClimatePanel state={state} />
            </Panel>

            <Panel title="Vehicle health">
              <dl className="space-y-1 text-sm">
                <Row label="12V battery" value={titleCase(sv(state, "twelveVoltBatteryHealth"))} />
                <Row label="Brake fluid" value={brakeFluidLabel(state)} />
                <Row label="Wiper fluid" value={titleCase(sv(state, "wiperFluidState"))} />
                <Row label="Drive mode" value={titleCase(sv(state, "driveMode"))} />
                <Row label="Gear guard" value={titleCase(sv(state, "gearGuardLocked"))} />
                <Row label="Charge port" value={titleCase(sv(state, "chargePortState"))} />
              </dl>
            </Panel>

            <LoadingScope loading={insightsPending}>
              <Panel title="Battery & energy">
                <BatteryEnergyPanel insights={insights} cellType={sv(state, "batteryCellType")} />
              </Panel>

              <Panel title="Connectivity">
                <ConnectivityPanel insights={insights} />
              </Panel>
            </LoadingScope>
          </div>
        </LoadingScope>
      </section>
    </div>
  );
}

function SectionHeading(props: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {props.children}
      </h2>
      {props.action}
    </div>
  );
}

const ACTIVITY_COLOR: Record<ActivityKind, string> = {
  driving: "var(--series-1)",
  charging: "var(--status-good)",
  plugged: "var(--status-good)",
  parked: "var(--text-secondary)",
  asleep: "var(--text-muted)",
};

/** The car at a glance: charge and range up front, status chips, and where it is. */
function Hero(props: { vehicleId: string; vehicle?: VehicleDto; state: VehicleState | undefined }) {
  const { state, vehicle } = props;
  const loading = useLoading();
  const u = useUnits();
  const { data: liveSession } = useLiveCharging(props.vehicleId);

  // The live session follows Parallax, which reports a charge starting
  // before vehicle state does.
  const stateActivity = vehicleActivity(state);
  const activity =
    liveSession?.vehicleChargerState?.value === "charging_active" && stateActivity?.kind !== "driving"
      ? { kind: "charging" as const, label: "Charging" }
      : stateActivity;
  const charging = activity?.kind === "charging";
  // While charging, the live session carries Parallax's readings; vehicle
  // state fills in when it hasn't reported them.
  const live = (r: { value: string | number | null } | null | undefined) =>
    charging && r?.value != null ? Number(r.value) : null;
  const battery = live(liveSession?.soc) ?? nv(state, "batteryLevel");
  const limit = live(liveSession?.socLimit) ?? nv(state, "batteryLimit");
  const rangeKm = nv(state, "distanceToEmpty");
  const mileageM = nv(state, "vehicleMileage");
  const speedMps = nv(state, "gnssSpeed");
  const loc = location(state);
  const locBehind = locationIsBehind(state);
  const trail = useActiveDriveTrail(props.vehicleId, loc);
  const security = securitySummary(state, vehicle?.model);
  const chargePower = live(liveSession?.power);
  const chargeRate = live(liveSession?.kilometersChargedPerHour);
  const secondsLeft = live(liveSession?.timeRemaining);
  const outlook = chargeOutlook({
    soc: battery,
    limit,
    powerKw: chargePower,
    capacityKwh: live(liveSession?.batteryCapacityKwh) ?? nv(state, "batteryCapacity"),
    minutesLeft: secondsLeft != null ? secondsLeft / 60 : null,
  });

  const ota = softwareUpdate(state);
  // Scales today's estimate, so it follows the vehicle's own recent efficiency.
  const rangeAtLimit = rangeKm != null && battery != null && battery > 0 && limit != null ? (rangeKm * limit) / battery : null;

  const name = vehicle?.name ?? vehicle?.model ?? "Vehicle";
  const subtitle = [vehicle?.modelYear, vehicle?.model].filter(Boolean).join(" ");

  return (
    <section className="card hero-card overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="flex flex-col gap-6 p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{name}</h1>
              {subtitle && subtitle !== name && (
                <p className="mt-0.5 text-sm text-[var(--text-muted)]">{subtitle}</p>
              )}
            </div>
            <FreshnessBadge state={state} />
          </div>

          <div className="flex flex-wrap gap-2">
            {loading ? (
              <>
                <Chip><Skeleton className="w-[5em]" /></Chip>
                <Chip><Skeleton className="w-[4em]" /></Chip>
                <Chip><Skeleton className="w-[5em]" /></Chip>
              </>
            ) : (
              <>
                {activity && (
                  <Chip dot={ACTIVITY_COLOR[activity.kind]} pulse={activity.kind === "charging" || activity.kind === "driving"}>
                    {activity.label}
                    {activity.kind === "driving" && speedMps != null && speedMps > 1 && ` · ${u.formatSpeed(speedMps * 3.6)}`}
                  </Chip>
                )}
                {security.locked !== null && (
                  <Chip dot={security.locked ? "var(--status-good)" : "var(--status-warning)"}>
                    {security.locked ? "Locked" : "Unlocked"}
                  </Chip>
                )}
                <Chip dot={security.open.length === 0 ? "var(--status-good)" : "var(--status-warning)"}>
                  <span title={security.open.join(", ") || undefined}>{security.openLabel}</span>
                </Chip>
                {ota && (
                  <Chip dot="var(--accent)" pulse={ota.phase === "downloading" || ota.phase === "installing"}>
                    {ota.label}
                    {ota.progress == null && ota.version && ` · ${ota.version}`}
                  </Chip>
                )}
                {nv(state, "cabinClimateInteriorTemperature") != null && (
                  <Chip>Cabin {u.formatTemperature(nv(state, "cabinClimateInteriorTemperature"))}</Chip>
                )}
              </>
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Battery</div>
                <div className="mt-1 flex items-baseline font-semibold tabular-nums leading-none tracking-tight">
                  {loading ? (
                    <Skeleton className="h-[3.5rem] w-[2.4em] text-5xl" />
                  ) : (
                    <>
                      <span className="text-6xl sm:text-7xl">{fmt(battery, 0)}</span>
                      <span className="ml-1 text-2xl text-[var(--text-secondary)]">%</span>
                    </>
                  )}
                </div>
              </div>
              <div className="pb-1">
                <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Est. range</div>
                <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
                  {loading ? <Skeleton className="w-[3.5em]" /> : u.formatDistance(rangeKm)}
                </div>
              </div>
            </div>

            <BatteryBar level={battery} limit={limit} charging={charging} />
          </div>

          <dl className="mt-auto grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
            <HeroFact label="Odometer" value={u.formatDistance(mileageM != null ? mileageM / 1000 : null)} />
            {charging ? (
              <>
                <HeroFact
                  label="Charging at"
                  value={
                    chargePower == null
                      ? "—"
                      : `${fmt(chargePower, 1)} kW${chargeRate ? ` · ${u.formatChargeRate(chargeRate)}` : ""}`
                  }
                />
                {/* A schedule can end the session before it reaches the limit. */}
                <HeroFact
                  label={outlook.kind === "session" ? "Session ends in" : "Time to limit"}
                  value={
                    outlook.minutes == null
                      ? "—"
                      : outlook.kind === "session" && outlook.endSoc != null
                        ? `${fmtSeconds(outlook.minutes * 60)} · ~${fmt(outlook.endSoc, 0)}%`
                        : fmtSeconds(outlook.minutes * 60)
                  }
                />
              </>
            ) : (
              <>
                <HeroFact
                  label={limit != null ? `Range at ${fmt(limit, 0)}%` : "Range at limit"}
                  value={u.formatDistance(rangeAtLimit)}
                />
                <HeroFact label="Software" value={sv(state, "otaCurrentVersion") ?? "—"} />
              </>
            )}
          </dl>
        </div>

        <div className="hero-map relative min-h-[18rem] border-t border-[var(--border)] lg:min-h-[26rem] lg:border-l lg:border-t-0">
          {loading ? (
            <SkeletonBlock height="100%" className="absolute inset-0 rounded-none" />
          ) : loc ? (
            <>
              <div className="absolute inset-0">
                <VehicleMap
                  lat={loc.lat}
                  lon={loc.lon}
                  bearing={nv(state, "gnssBearing")}
                  trail={trail}
                  stale={locBehind}
                  height="100%"
                />
              </div>
              <div
                className={`pointer-events-none absolute left-3 top-3 max-w-[calc(100%-4.5rem)] rounded-md border bg-[color-mix(in_srgb,var(--surface-1)_85%,transparent)] px-2.5 py-1 text-xs backdrop-blur ${
                  locBehind
                    ? "border-[var(--status-warning)] text-[var(--text-primary)]"
                    : "border-[var(--border)] text-[var(--text-secondary)]"
                }`}
              >
                Location from {new Date(loc.ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                {locBehind && <span className="text-[var(--text-secondary)]"> · no GPS from the vehicle since</span>}
              </div>
            </>
          ) : (
            <div className="absolute inset-0 grid place-items-center text-sm text-[var(--text-muted)]">
              No location yet.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Chip(props: { children: ReactNode; dot?: string; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-xs font-medium text-[var(--text-primary)]">
      {props.dot && (
        <span
          className={`h-1.5 w-1.5 rounded-full ${props.pulse ? "chip-dot--pulse" : ""}`}
          style={{ background: props.dot, color: props.dot }}
        />
      )}
      {props.children}
    </span>
  );
}

function HeroFact(props: { label: string; value: ReactNode }) {
  const loading = useLoading();
  return (
    <div className="bg-[var(--surface-1)] px-3 py-2.5 last:max-sm:col-span-2">
      <dt className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{props.label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium tabular-nums">
        {loading ? <Skeleton className="w-[5em]" /> : props.value}
      </dd>
    </div>
  );
}

/** State of charge with the charge limit marked; shimmers while charging. */
function BatteryBar(props: { level: number | null; limit: number | null; charging: boolean }) {
  const loading = useLoading();
  const level = loading || props.level == null ? 0 : Math.min(100, Math.max(0, props.level));
  const tone = props.charging ? "charging" : level < 15 ? "low" : level < 30 ? "warn" : "ok";
  return (
    <div className="mt-4">
      <div
        className="battery-bar"
        role="meter"
        aria-label="Battery level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={props.level ?? undefined}
      >
        <div className={`battery-bar__fill battery-bar__fill--${tone}`} style={{ width: `${level}%` }} />
        {props.limit != null && !loading && (
          <div className="battery-bar__limit" style={{ left: `${Math.min(100, props.limit)}%` }} />
        )}
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] text-[var(--text-muted)]">
        {/* Centered under the tick, but kept inside the bar near either end. */}
        {props.limit != null && !loading && (
          <span
            className="absolute whitespace-nowrap"
            style={{
              left: `${Math.min(100, props.limit)}%`,
              transform: `translateX(${props.limit < 15 ? "0" : props.limit > 85 ? "-100%" : "-50%"})`,
            }}
          >
            Limit {fmt(props.limit, 0)}%
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The route so far of a drive under way, ending at the vehicle. The map
 * keeps following the vehicle; the trail is only drawn behind it.
 */
function useActiveDriveTrail(vehicleId: string, loc: { lat: number; lon: number } | null): [number, number][] | undefined {
  // Shares the drive list and drive detail caches with the other pages.
  const { data: drives } = useQuery({
    queryKey: ["drives", vehicleId],
    queryFn: () => api.drives(vehicleId),
    refetchInterval: (query) => (query.state.data?.[0] && !query.state.data[0].endedAt ? 15_000 : 60_000),
  });
  const active = drives?.[0] && !drives[0].endedAt ? drives[0].id : null;
  const { data: detail } = useQuery({
    queryKey: ["drive", active],
    queryFn: () => api.drive(active!),
    enabled: active != null,
    refetchInterval: 15_000,
  });
  if (active == null || detail?.id !== active) return undefined;
  const points = detail.points.filter((p) => isPosition(p.lat, p.lon)).map((p) => [p.lat, p.lon] as [number, number]);
  return loc ? [...points, [loc.lat, loc.lon]] : points;
}

/** Last drive and last charge, each linking to its page. */
function RecentActivity(props: { vehicleId: string }) {
  const { data: drives, isPending: drivesPending } = useQuery({
    queryKey: ["drives", props.vehicleId],
    queryFn: () => api.drives(props.vehicleId),
    // A drive in progress grows by the second.
    refetchInterval: (query) => (query.state.data?.[0] && !query.state.data[0].endedAt ? 15_000 : 60_000),
  });
  const { data: state } = useVehicleState(props.vehicleId);
  const { data: sessions, isPending: sessionsPending } = useQuery({
    queryKey: ["chargingSessions", props.vehicleId],
    queryFn: () => api.chargingSessions(props.vehicleId),
    refetchInterval: 60_000,
  });
  // Keeps "2 h ago" and a live drive's duration current.
  const driving = drives?.[0] != null && !drives[0].endedAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), driving ? 15_000 : 60_000);
    return () => clearInterval(t);
  }, [driving]);

  return (
    <section>
      <SectionHeading>Recent activity</SectionHeading>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LoadingScope loading={drivesPending}>
          <LastDriveCard drive={drives?.[0]} now={now} speedMps={nv(state, "gnssSpeed")} />
        </LoadingScope>
        <LoadingScope loading={sessionsPending}>
          <LastChargeCard session={sessions?.[0]} now={now} />
        </LoadingScope>
      </div>
    </section>
  );
}

function ActivityCard(props: {
  to: string;
  title: string;
  when: ReactNode;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      to={props.to}
      className="card activity-card group flex flex-col gap-4 p-5 transition-colors hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--surface-2)] text-[var(--accent)]">
            {props.icon}
          </span>
          <span className="text-sm font-medium">{props.title}</span>
        </span>
        <span className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          {props.when}
          <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>
            →
          </span>
        </span>
      </div>
      {props.children}
    </Link>
  );
}

function ActivityStats(props: { items: { label: string; value: ReactNode }[] }) {
  const loading = useLoading();
  return (
    <dl className={`grid gap-3 ${props.items.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
      {props.items.map((i) => (
        <div key={i.label}>
          <dt className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{i.label}</dt>
          <dd className="mt-0.5 text-sm font-medium tabular-nums">
            {loading ? <Skeleton className="w-[4em]" /> : i.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function LastDriveCard(props: { drive: DriveDto | undefined; now: number; speedMps: number | null }) {
  const loading = useLoading();
  const u = useUnits();
  const d = props.drive;
  const live = d != null && !d.endedAt;
  const used = d?.startBattery != null && d.endBattery != null ? d.startBattery - d.endBattery : null;
  // The start is looked up as a drive begins; give it a couple of minutes.
  const locating = live && props.now - Date.parse(d.startedAt) < 2 * 60_000;
  const from = d?.start?.label ?? (locating ? "Locating start…" : "Unknown");
  // A drive under way has an end only if navigation set one.
  const to = live ? (d?.destination?.name ?? null) : (d?.end?.label ?? "Unknown");
  const stats = [
    { label: "Distance", value: u.formatDistance(d?.distanceKm, 1) },
    { label: "Duration", value: d ? fmtDuration(d.startedAt, d.endedAt, props.now) : "—" },
    ...(live
      ? [{ label: "Speed", value: props.speedMps != null ? u.formatSpeed(Math.max(0, props.speedMps) * 3.6) : "—" }]
      : []),
    { label: "Battery", value: used == null ? "—" : used < 0.05 ? "0%" : `−${fmt(used, 1)}%` },
  ];

  if (!loading && !d) {
    return (
      <ActivityCard to="/drives" title="Last drive" when="" icon={<DriveIcon />}>
        <p className="text-sm text-[var(--text-muted)]">No drives recorded yet. They appear here after the first trip.</p>
      </ActivityCard>
    );
  }

  return (
    <ActivityCard
      to="/drives"
      title={live ? "Driving now" : "Last drive"}
      when={loading || !d ? <Skeleton className="w-[4em]" /> : live ? "In progress" : relativeTime(new Date(d.endedAt!), props.now)}
      icon={<DriveIcon />}
    >
      <div className="flex min-w-0 items-center gap-2 text-base font-medium">
        {loading ? (
          <Skeleton className="w-[14em]" />
        ) : (
          to == null ? (
            <>
              <span className="min-w-0 truncate" title={d?.start?.address ?? from}>
                <span className="text-[var(--text-muted)]">From </span>
                {from}
              </span>
              <span className="ml-auto shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs font-normal text-[var(--text-muted)]">
                No destination
              </span>
            </>
          ) : (
            <>
              <span className="max-w-[45%] shrink-0 truncate" title={d?.start?.address ?? from}>{from}</span>
              <span className="shrink-0 text-[var(--accent)]" aria-label="to">→</span>
              <span className="truncate" title={d?.end?.address ?? to}>{to}</span>
            </>
          )
        )}
      </div>
      <ActivityStats items={stats} />
    </ActivityCard>
  );
}

function LastChargeCard(props: { session: ChargingSessionDto | undefined; now: number }) {
  const loading = useLoading();
  const u = useUnits();
  const s = props.session;
  const live = s != null && !s.endedAt;
  const seconds = s ? chargingSecondsNow(s, props.now) : null;
  const cost = s?.cost ?? s?.estimatedCost ?? null;

  if (!loading && !s) {
    return (
      <ActivityCard to="/charging" title="Last charge" when="" icon={<ChargeIcon />}>
        <p className="text-sm text-[var(--text-muted)]">No charging sessions yet. They appear here after the next plug-in.</p>
      </ActivityCard>
    );
  }

  return (
    <ActivityCard
      to="/charging"
      title={live ? "Charging session" : "Last charge"}
      when={loading || !s ? <Skeleton className="w-[4em]" /> : live ? "In progress" : relativeTime(new Date(s.endedAt!), props.now)}
      icon={<ChargeIcon />}
    >
      <div className="flex min-w-0 items-center gap-3">
        {loading || !s ? (
          <Skeleton className="w-[14em]" />
        ) : s.startSoc == null && s.endSoc == null ? (
          <span className="truncate text-base font-medium">{chargerLabel(s)}</span>
        ) : (
          <>
            <span className="shrink-0 text-base font-medium tabular-nums">
              {s.startSoc != null ? `${fmt(s.startSoc, 0)}%` : "?"}
              <span className="mx-1.5 text-[var(--accent)]">→</span>
              {s.endSoc != null ? `${fmt(s.endSoc, 0)}%` : "?"}
            </span>
            <SocSpan start={s.startSoc} end={s.endSoc} />
            <span className="shrink-0 truncate text-sm text-[var(--text-secondary)]">{chargerLabel(s)}</span>
          </>
        )}
      </div>
      <ActivityStats
        items={[
          { label: "Energy", value: s?.energyKwh != null ? `${fmt(s.energyKwh, 1)} kWh` : "—" },
          { label: "Time charging", value: seconds != null ? fmtSeconds(seconds) : "—" },
          s?.rangeAddedKm != null && cost == null
            ? { label: "Range added", value: u.formatDistance(s.rangeAddedKm) }
            : {
                label: s?.cost == null && s?.estimatedCost != null ? "Est. cost" : "Cost",
                value: cost != null ? formatMoney(cost, s?.currency ?? null) : "—",
              },
        ]}
      />
    </ActivityCard>
  );
}

/** A slim track showing the part of the pack a charge filled. */
function SocSpan(props: { start: number | null; end: number | null }) {
  if (props.start == null || props.end == null || props.end <= props.start) {
    return <span className="flex-1" />;
  }
  return (
    <span className="relative h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]" aria-hidden>
      <span
        className="absolute inset-y-0 rounded-full bg-[var(--status-good)]"
        style={{ left: `${props.start}%`, width: `${props.end - props.start}%` }}
      />
    </span>
  );
}

function DriveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="19" r="2" />
      <path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16" />
      <circle cx="18" cy="5" r="2" />
    </svg>
  );
}

function ChargeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13 3 5 14h6l-1 7 8-11h-6z" />
    </svg>
  );
}
