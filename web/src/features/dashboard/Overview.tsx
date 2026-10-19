import { useEffect, useState, type ReactNode } from 'react';
import type { VehicleDto, VehicleState } from '@server/api-types';
import { isTeslaMateVehicle } from '@server/teslamate/ids';
import {
  useChargingSessions,
  useDrives,
  useInsights,
  useLiveCharging,
  useUnits,
} from '../../api/hooks';
import { Dot } from '../../components/Dot';
import { Skeleton, SkeletonBlock, useLoading } from '../../components/LoadingState';
import { VehicleMap } from '../../components/VehicleMap';
import { chargeOutlook, chargerLabel, lastChargedTo } from '../../lib/charging';
import { locationIsBehind } from '../../lib/freshness';
import { isActivePhase, softwareUpdate } from '../../lib/ota';
import { fmt, fmtSeconds, location, nv, sv } from '../../lib/state';
import {
  type ActivityKind,
  climateRunning,
  securitySummary,
  vehicleActivity,
} from '../../lib/vehicleStatus';
import { ChargeGauge } from './ChargeGauge';
import { statusSentence } from './status';
import { useActiveDriveTrail } from './useActiveDriveTrail';

const ACTIVITY_COLOR: Record<ActivityKind, string> = {
  driving: 'var(--series-1)',
  charging: 'var(--status-good)',
  plugged: 'var(--status-good)',
  parked: 'var(--text-secondary)',
  asleep: 'var(--series-3)',
};

/**
 * The vehicle right now: a sentence saying what it's doing and where, its
 * charge as an instrument readout, the figures that go with it, and the map.
 */
export function Overview(props: {
  vehicleId: string;
  vehicle?: VehicleDto;
  state: VehicleState | undefined;
}) {
  const { state, vehicle } = props;
  const loading = useLoading();
  const u = useUnits();
  const { data: liveSession } = useLiveCharging(props.vehicleId);
  const { data: insights } = useInsights(props.vehicleId);
  const { data: drives } = useDrives(props.vehicleId);
  const { data: sessions } = useChargingSessions(props.vehicleId);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // The live session follows Parallax, which reports a charge starting
  // before vehicle state does.
  const stateActivity = vehicleActivity(state);
  const activity =
    liveSession?.vehicleChargerState?.value === 'charging_active' &&
    stateActivity?.kind !== 'driving'
      ? { kind: 'charging' as const, label: 'Charging' }
      : stateActivity;
  const charging = activity?.kind === 'charging';
  // While charging, the live session carries Parallax's readings; vehicle
  // state fills in when it hasn't reported them.
  const live = (r: { value: string | number | null } | null | undefined) =>
    charging && r?.value != null ? Number(r.value) : null;
  const battery = live(liveSession?.soc) ?? nv(state, 'batteryLevel');
  const limit = live(liveSession?.socLimit) ?? nv(state, 'batteryLimit');
  const rangeKm = nv(state, 'distanceToEmpty');
  const cold = (insights?.coldWeather?.rangeImpactKm ?? 0) > 0 ? insights!.coldWeather : null;
  const mileageM = nv(state, 'vehicleMileage');
  const speedMps = nv(state, 'gnssSpeed');
  const loc = location(state);
  const locBehind = locationIsBehind(state);
  const trail = useActiveDriveTrail(props.vehicleId, loc);
  const navigation = insights?.navigation;
  const plan = navigation
    ? {
        route: navigation.route,
        destination: [navigation.destination.lat, navigation.destination.lon] as [number, number],
      }
    : null;
  const security = securitySummary(state, vehicle?.model);
  // TeslaMate doesn't log doors or windows, so "all closed" would be a guess.
  const closuresKnown = !isTeslaMateVehicle(props.vehicleId);
  const chargePower = live(liveSession?.power);
  const chargeRate = live(liveSession?.kilometersChargedPerHour);
  const secondsLeft = live(liveSession?.timeRemaining);
  const outlook = chargeOutlook({
    soc: battery,
    limit,
    powerKw: chargePower,
    capacityKwh: live(liveSession?.batteryCapacityKwh) ?? nv(state, 'batteryCapacity'),
    minutesLeft: secondsLeft != null ? secondsLeft / 60 : null,
  });
  const ota = softwareUpdate(state);
  // Without a reported limit (TeslaMate doesn't log it), the level the last
  // charge reached is the best guide to where it's usually charged to.
  const lastCharge = limit == null ? lastChargedTo(sessions) : null;
  const target = limit ?? lastCharge;
  // Scales today's estimate, so it follows the vehicle's own recent efficiency.
  const rangeAtLimit =
    rangeKm != null && battery != null && battery > 0 && target != null
      ? (rangeKm * target) / battery
      : null;

  // Where it is: the charger while plugged in, otherwise where the last drive ended.
  const session = sessions?.[0] && !sessions[0].endedAt ? sessions[0] : null;
  const lastDrive = drives?.[0]?.endedAt ? drives[0] : null;
  const plugged = activity?.kind === 'charging' || activity?.kind === 'plugged';
  const status = activity
    ? statusSentence({
        kind: activity.kind,
        place: plugged ? (session ? chargerLabel(session) : null) : (lastDrive?.end?.label ?? null),
        since: plugged
          ? session
            ? Date.parse(
                activity.kind === 'charging'
                  ? (session.chargingStartedAt ?? session.startedAt)
                  : session.startedAt,
              )
            : null
          : lastDrive
            ? Date.parse(lastDrive.endedAt!)
            : null,
        destination: navigation?.destination.name,
        speed: speedMps != null && speedMps > 1 ? u.formatSpeed(speedMps * 3.6) : null,
        now,
      })
    : null;
  // The cabin's temperature lives in the Climate panel; here it's news only
  // while something is running to change it.
  const climateOn = climateRunning(state);
  const cabin = nv(state, 'cabinClimateInteriorTemperature');

  return (
    <section className="card overflow-hidden">
      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="flex min-w-0 flex-col p-5 sm:p-7">
          {/* What it's doing, in words. */}
          <div className="min-h-[3.25rem]">
            {loading || !status ? (
              <>
                <Skeleton className="h-7 w-[12em]" />
                <div className="mt-2">
                  <Skeleton className="w-[16em]" />
                </div>
              </>
            ) : (
              <>
                <p className="flex items-center gap-3 text-lg leading-7 font-medium tracking-[-0.01em]">
                  <Dot
                    color={ACTIVITY_COLOR[status.kind]}
                    pulse={status.kind === 'charging' || status.kind === 'driving'}
                    size="md"
                  />
                  <span className="min-w-0 truncate">
                    {status.headline}
                    {status.detail && (
                      <span className="font-normal text-(--text-muted)"> {status.detail}</span>
                    )}
                  </span>
                </p>
                <ul className="mt-1.5 ml-5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-(--text-secondary)">
                  {security.locked !== null && (
                    <li className={security.locked ? '' : 'text-(--status-warning)'}>
                      {security.locked ? 'Locked' : 'Unlocked'}
                    </li>
                  )}
                  {closuresKnown && (
                    <li
                      className={security.open.length > 0 ? 'text-(--status-warning)' : ''}
                      title={security.open.join(', ') || undefined}
                    >
                      {security.openLabel}
                    </li>
                  )}
                  {climateOn && (
                    <li>Climate on{cabin != null && ` · cabin ${u.formatTemperature(cabin)}`}</li>
                  )}
                </ul>
              </>
            )}
          </div>

          {/* Charge, as the instrument cluster would show it. */}
          <div className="mt-6 flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <div className="eyebrow">{charging ? 'Charging' : 'Battery'}</div>
              <div className="mt-2 flex items-start">
                <span className="readout relative text-[4rem] font-light sm:text-[4.75rem]">
                  {/* While loading, a placeholder the size of two digits, so the
                      range beside it doesn't move when the level arrives. */}
                  {loading ? (
                    <>
                      <span className="invisible">00</span>
                      <Skeleton className="absolute inset-0 h-full w-full" />
                    </>
                  ) : (
                    fmt(battery, 0)
                  )}
                </span>
                <span className="readout mt-1.5 ml-1 text-xl font-light text-(--text-muted) sm:mt-2">
                  %
                </span>
              </div>
            </div>
            <div className="pb-1.5">
              <div className="eyebrow">Est. range</div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="readout text-[2.25rem] font-[350]">
                  {loading ? <Skeleton className="w-[2.5em]" /> : fmt(u.distance(rangeKm), 0)}
                </span>
                <span className="text-base text-(--text-muted)">{u.distanceUnit}</span>
              </div>
              {/* Only while the cold is holding range back; Health has the rest. */}
              {!loading && cold && (
                <div className="mt-1 text-xs text-(--text-muted)">
                  −{u.formatDistance(cold.rangeImpactKm)} from the cold
                </div>
              )}
            </div>
          </div>

          <div className="mt-4">
            <ChargeGauge
              level={battery}
              limit={target}
              limitLabel={limit == null ? 'Last charge' : undefined}
              charging={charging}
            />
          </div>

          {ota && (
            <div className="mt-6 flex items-center gap-3 rounded-lg bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-3.5 py-2.5 text-sm shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_22%,transparent)]">
              <Dot color="var(--accent)" pulse={isActivePhase(ota.phase)} size="md" />
              <span className="min-w-0 flex-1 truncate">
                {ota.label}
                {ota.version && <span className="text-(--text-muted)"> · {ota.version}</span>}
              </span>
              {ota.progress != null && (
                <span className="tabular-nums text-(--text-secondary)">
                  {fmt(ota.progress, 0)}%
                </span>
              )}
            </div>
          )}

          {/* The figures sit at the foot, level with the bottom of the map. */}
          <div aria-hidden className="min-h-6 flex-1" />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-(--hairline) pt-5 sm:grid-cols-3">
            <Figure label="Odometer">
              {u.formatDistance(mileageM != null ? mileageM / 1000 : null)}
            </Figure>
            {charging ? (
              <>
                <Figure label="Charging at">
                  {chargePower == null ? (
                    '—'
                  ) : (
                    <>
                      {fmt(chargePower, 1)} kW
                      {chargeRate ? (
                        <span className="text-(--text-muted)">
                          {' '}
                          · {u.formatChargeRate(chargeRate)}
                        </span>
                      ) : null}
                    </>
                  )}
                </Figure>
                {/* A schedule can end the session before it reaches the limit. */}
                <Figure label={outlook.kind === 'session' ? 'Session ends in' : 'Time to limit'}>
                  {outlook.minutes == null
                    ? '—'
                    : outlook.kind === 'session' && outlook.endSoc != null
                      ? `${fmtSeconds(outlook.minutes * 60)} · ~${fmt(outlook.endSoc, 0)}%`
                      : fmtSeconds(outlook.minutes * 60)}
                </Figure>
              </>
            ) : (
              <>
                <Figure label={target != null ? `Range at ${fmt(target, 0)}%` : 'Range at limit'}>
                  {u.formatDistance(rangeAtLimit)}
                </Figure>
                <Figure label="Software">{sv(state, 'otaCurrentVersion') ?? '—'}</Figure>
              </>
            )}
          </dl>
        </div>

        <div className="overview-map relative min-h-72 border-t border-(--hairline) xl:min-h-[25rem] xl:border-t-0 xl:border-l">
          {loading ? (
            <SkeletonBlock height="100%" className="absolute inset-0 rounded-none" />
          ) : loc ? (
            <>
              <div className="absolute inset-0">
                <VehicleMap
                  lat={loc.lat}
                  lon={loc.lon}
                  bearing={nv(state, 'gnssBearing')}
                  trail={trail}
                  stale={locBehind}
                  plan={plan}
                  height="100%"
                />
              </div>
              <div
                className={`pointer-events-none absolute top-3 left-3 max-w-[calc(100%-4.5rem)] rounded-lg border bg-[color-mix(in_srgb,var(--surface-0)_80%,transparent)] px-2.5 py-1 text-xs backdrop-blur-md ${
                  locBehind
                    ? 'border-(--status-warning) text-(--text-primary)'
                    : 'border-(--hairline) text-(--text-secondary)'
                }`}
              >
                Located{' '}
                {new Date(loc.ts).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                {locBehind && (
                  <span className="text-(--text-secondary)"> · no GPS from the vehicle since</span>
                )}
              </div>
            </>
          ) : (
            <div className="absolute inset-0 grid place-items-center text-sm text-(--text-muted)">
              No location yet.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Figure(props: { label: string; children: ReactNode }) {
  const loading = useLoading();
  return (
    <div className="min-w-0 last:max-sm:col-span-2">
      <dt className="eyebrow">{props.label}</dt>
      <dd className="mt-1.5 truncate text-[0.9375rem] font-medium tabular-nums">
        {loading ? <Skeleton className="w-[5em]" /> : props.children}
      </dd>
    </div>
  );
}
