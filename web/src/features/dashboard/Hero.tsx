import type { VehicleDto, VehicleState } from '@server/api-types';
import { useLiveCharging, useUnits } from '../../api/hooks';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { Skeleton, SkeletonBlock, useLoading } from '../../components/LoadingState';
import { VehicleMap } from '../../components/VehicleMap';
import { chargeOutlook } from '../../lib/charging';
import { locationIsBehind } from '../../lib/freshness';
import { softwareUpdate } from '../../lib/ota';
import { fmt, fmtSeconds, location, nv, sv } from '../../lib/state';
import { type ActivityKind, securitySummary, vehicleActivity } from '../../lib/vehicleStatus';
import { BatteryBar } from './BatteryBar';
import { Chip } from './Chip';
import { HeroFact } from './HeroFact';
import { useActiveDriveTrail } from './useActiveDriveTrail';

const ACTIVITY_COLOR: Record<ActivityKind, string> = {
  driving: 'var(--series-1)',
  charging: 'var(--status-good)',
  plugged: 'var(--status-good)',
  parked: 'var(--text-secondary)',
  asleep: 'var(--text-muted)',
};

/** The car at a glance: charge and range up front, status chips, and where it is. */
export function Hero(props: {
  vehicleId: string;
  vehicle?: VehicleDto;
  state: VehicleState | undefined;
}) {
  const { state, vehicle } = props;
  const loading = useLoading();
  const u = useUnits();
  const { data: liveSession } = useLiveCharging(props.vehicleId);

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
  const mileageM = nv(state, 'vehicleMileage');
  const speedMps = nv(state, 'gnssSpeed');
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
    capacityKwh: live(liveSession?.batteryCapacityKwh) ?? nv(state, 'batteryCapacity'),
    minutesLeft: secondsLeft != null ? secondsLeft / 60 : null,
  });

  const ota = softwareUpdate(state);
  // Scales today's estimate, so it follows the vehicle's own recent efficiency.
  const rangeAtLimit =
    rangeKm != null && battery != null && battery > 0 && limit != null
      ? (rangeKm * limit) / battery
      : null;

  const name = vehicle?.name ?? vehicle?.model ?? 'Vehicle';
  const subtitle = [vehicle?.modelYear, vehicle?.model].filter(Boolean).join(' ');

  return (
    <section className="card hero-card overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="flex flex-col gap-6 p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{name}</h1>
              {subtitle && subtitle !== name && (
                <p className="mt-0.5 text-sm text-(--text-muted)">{subtitle}</p>
              )}
            </div>
            <FreshnessBadge state={state} />
          </div>

          <div className="flex flex-wrap gap-2">
            {loading ? (
              <>
                <Chip>
                  <Skeleton className="w-[5em]" />
                </Chip>
                <Chip>
                  <Skeleton className="w-[4em]" />
                </Chip>
                <Chip>
                  <Skeleton className="w-[5em]" />
                </Chip>
              </>
            ) : (
              <>
                {activity && (
                  <Chip
                    dot={ACTIVITY_COLOR[activity.kind]}
                    pulse={activity.kind === 'charging' || activity.kind === 'driving'}
                  >
                    {activity.label}
                    {activity.kind === 'driving' &&
                      speedMps != null &&
                      speedMps > 1 &&
                      ` · ${u.formatSpeed(speedMps * 3.6)}`}
                  </Chip>
                )}
                {security.locked !== null && (
                  <Chip dot={security.locked ? 'var(--status-good)' : 'var(--status-warning)'}>
                    {security.locked ? 'Locked' : 'Unlocked'}
                  </Chip>
                )}
                <Chip
                  dot={security.open.length === 0 ? 'var(--status-good)' : 'var(--status-warning)'}
                >
                  <span title={security.open.join(', ') || undefined}>{security.openLabel}</span>
                </Chip>
                {ota && (
                  <Chip
                    dot="var(--accent)"
                    pulse={ota.phase === 'downloading' || ota.phase === 'installing'}
                  >
                    {ota.label}
                    {ota.progress == null && ota.version && ` · ${ota.version}`}
                  </Chip>
                )}
                {nv(state, 'cabinClimateInteriorTemperature') != null && (
                  <Chip>
                    Cabin {u.formatTemperature(nv(state, 'cabinClimateInteriorTemperature'))}
                  </Chip>
                )}
              </>
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-(--text-muted)">Battery</div>
                <div className="mt-1 flex items-baseline font-semibold tabular-nums leading-none tracking-tight">
                  {loading ? (
                    <Skeleton className="h-14 w-[2.4em] text-5xl" />
                  ) : (
                    <>
                      <span className="text-6xl sm:text-7xl">{fmt(battery, 0)}</span>
                      <span className="ml-1 text-2xl text-(--text-secondary)">%</span>
                    </>
                  )}
                </div>
              </div>
              <div className="pb-1">
                <div className="text-xs uppercase tracking-wide text-(--text-muted)">
                  Est. range
                </div>
                <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
                  {loading ? <Skeleton className="w-[3.5em]" /> : u.formatDistance(rangeKm)}
                </div>
              </div>
            </div>

            <BatteryBar level={battery} limit={limit} charging={charging} />
          </div>

          <dl className="mt-auto grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-(--border) bg-(--border) sm:grid-cols-3">
            <HeroFact
              label="Odometer"
              value={u.formatDistance(mileageM != null ? mileageM / 1000 : null)}
            />
            {charging ? (
              <>
                <HeroFact
                  label="Charging at"
                  value={
                    chargePower == null
                      ? '—'
                      : `${fmt(chargePower, 1)} kW${chargeRate ? ` · ${u.formatChargeRate(chargeRate)}` : ''}`
                  }
                />
                {/* A schedule can end the session before it reaches the limit. */}
                <HeroFact
                  label={outlook.kind === 'session' ? 'Session ends in' : 'Time to limit'}
                  value={
                    outlook.minutes == null
                      ? '—'
                      : outlook.kind === 'session' && outlook.endSoc != null
                        ? `${fmtSeconds(outlook.minutes * 60)} · ~${fmt(outlook.endSoc, 0)}%`
                        : fmtSeconds(outlook.minutes * 60)
                  }
                />
              </>
            ) : (
              <>
                <HeroFact
                  label={limit != null ? `Range at ${fmt(limit, 0)}%` : 'Range at limit'}
                  value={u.formatDistance(rangeAtLimit)}
                />
                <HeroFact label="Software" value={sv(state, 'otaCurrentVersion') ?? '—'} />
              </>
            )}
          </dl>
        </div>

        <div className="hero-map relative min-h-72 border-t border-(--border) lg:min-h-104 lg:border-l lg:border-t-0">
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
                  height="100%"
                />
              </div>
              <div
                className={`pointer-events-none absolute left-3 top-3 max-w-[calc(100%-4.5rem)] rounded-md border bg-[color-mix(in_srgb,var(--surface-1)_85%,transparent)] px-2.5 py-1 text-xs backdrop-blur ${
                  locBehind
                    ? 'border-(--status-warning) text-(--text-primary)'
                    : 'border-(--border) text-(--text-secondary)'
                }`}
              >
                Location from{' '}
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
