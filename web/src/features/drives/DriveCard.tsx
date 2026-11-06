import type { ReactNode } from 'react';
import type { DriveDetailDto, DrivePlaceDto } from '@server/api-types';
import { isTeslaMateVehicle } from '@server/teslamate/ids';
import { useDrivers, useSetDriveDriver, useUnits } from '../../api/hooks';
import { InProgressTag } from '../../components/InProgressTag';
import { PlaceIcon } from '../../components/PlaceIcon';
import { Skeleton, useLoading } from '../../components/LoadingState';
import { type StatTile, StatTiles } from '../../components/StatTiles';
import { movingSpeedKmh, rangeUsedKm } from '../../lib/drives';
import { clock, longDay, shortDate } from '../../lib/format';
import { fmt, fmtDuration, titleCase } from '../../lib/state';
import { WeatherIcon, WindArrow } from '../../components/WeatherIcon';
import { compass, isDaytime, weatherKind, weatherLabel } from '../../lib/weather';
import { Select } from '../../components/Select';

/** The chosen drive: where it went up front, then its figures. */
export function DriveCard(props: {
  vehicleId: string;
  drive: DriveDetailDto | undefined;
  action?: ReactNode;
}) {
  const u = useUnits();
  const loading = useLoading();
  const d = props.drive;
  const live = d != null && !d.endedAt;
  const rangeUsed = d ? rangeUsedKm(d.startRangeKm, d.endRangeKm) : null;
  const movingSpeed = d ? movingSpeedKmh(d.distanceKm, d.movingSeconds) : null;
  const to =
    d?.end?.label ?? (live && d?.destination?.name ? `Navigating to ${d.destination.name}` : null);

  const tiles: StatTile[] = [
    {
      label: 'Distance',
      value: u.formatDistance(d?.distanceKm, 1),
      sub:
        rangeUsed != null
          ? `${rangeUsed < 0 ? 'Gained' : 'Used'} ${u.formatDistance(Math.abs(rangeUsed))} of range`
          : undefined,
    },
    {
      label: 'Duration',
      value: d ? fmtDuration(d.startedAt, d.endedAt) : '—',
      sub: movingSpeed != null ? `${u.formatSpeed(movingSpeed)} avg moving` : undefined,
    },
    {
      label: 'Efficiency',
      value: u.formatEfficiency(d?.distanceKm, d?.energyKwh),
      sub: u.formatConsumption(d?.distanceKm, d?.energyKwh) ?? undefined,
    },
    {
      label: 'Battery',
      value:
        d?.startBattery != null && d.endBattery != null
          ? `${fmt(d.startBattery, 1)}% → ${fmt(d.endBattery, 1)}%`
          : '—',
      sub: d?.energyKwh != null ? `${fmt(d.energyKwh, 1)} kWh used` : undefined,
    },
    {
      label: 'Top speed',
      value: u.formatSpeed(d?.maxSpeedKmh),
      sub: d?.driveMode ? `${titleCase(d.driveMode)} mode` : undefined,
    },
    {
      label: 'Elevation',
      value:
        d?.elevationGainM != null || d?.elevationLossM != null
          ? `↑ ${u.formatElevation(d?.elevationGainM)}`
          : '—',
      sub: d?.elevationLossM != null ? `↓ ${u.formatElevation(d.elevationLossM)}` : undefined,
    },
  ];

  // Not clipped, so the driver list can open past its edge; the tiles are.
  // When it ran is one line along the top with who drove after it; on a phone
  // the date is shortened to fit, who drove goes to the right, and the weather
  // goes below the places.
  return (
    <section className="card">
      <div className="p-5">
        <div className="flex min-h-7 items-center justify-between gap-3 text-sm text-(--text-muted) sm:justify-start">
          {loading || !d ? (
            <Skeleton className="w-[14em]" />
          ) : (
            <>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">
                  <span className="sm:hidden">{shortDate(d.startedAt)}</span>
                  <span className="hidden sm:inline">{longDay(d.startedAt)}</span> ·{' '}
                  {clock(d.startedAt)}
                  {d.endedAt ? ` – ${clock(d.endedAt)}` : ' – now'}
                </span>
                {live && <InProgressTag />}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <DriverPicker vehicleId={props.vehicleId} drive={d} />
                {props.action}
              </span>
            </>
          )}
        </div>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <h2 className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-base lg:text-xl font-semibold tracking-tight">
            {loading || !d ? (
              <Skeleton className="w-[16em]" />
            ) : (
              <>
                {live && to == null ? (
                  <>
                    <span className="text-(--text-secondary)">From</span>
                    <Place place={d.start} />
                  </>
                ) : (
                  <>
                    <Place place={d.start} />
                    <span aria-label="to" className="text-(--text-muted)">
                      →
                    </span>
                    {d.end ? (
                      <Place place={d.end} />
                    ) : (
                      <span className="text-(--text-secondary)">{to ?? '—'}</span>
                    )}
                  </>
                )}
              </>
            )}
          </h2>
          {d && !loading && <DriveWeather drive={d} />}
        </div>
      </div>
      <div className="overflow-hidden rounded-b-[calc(1rem-1px)]">
        <StatTiles tiles={tiles} columns="sm:grid-cols-3 lg:grid-cols-6" />
      </div>
    </section>
  );
}

const NOBODY = 'none';

/**
 * Who drove, to change by hand: one of the vehicle's drivers, or nobody.
 * Just the name where there's no one to pick from (TeslaMate, or no
 * drivers seen yet).
 */
function DriverPicker(props: { vehicleId: string; drive: DriveDetailDto }) {
  const editable = !isTeslaMateVehicle(props.vehicleId);
  const { data: drivers } = useDrivers(props.vehicleId, editable);
  const setDriver = useSetDriveDriver(props.vehicleId);
  const current = props.drive.driver;
  if (!editable || !drivers?.length) {
    return current && <span className="text-(--text-secondary)">{current.name}</span>;
  }
  // A driver no longer listed still shows as the one picked.
  const options = [
    { value: NOBODY, label: 'No driver' },
    ...drivers.map((r) => ({ value: String(r.id), label: r.name })),
    ...(current && !drivers.some((r) => r.id === current.id)
      ? [{ value: String(current.id), label: current.name }]
      : []),
  ];
  return (
    <Select
      label="Driver"
      compact
      value={current ? String(current.id) : NOBODY}
      options={options}
      disabled={setDriver.isPending}
      onChange={(value) =>
        setDriver.mutate({
          driveId: props.drive.id,
          driver: value === NOBODY ? null : (drivers.find((r) => String(r.id) === value) ?? null),
        })
      }
    />
  );
}

/** The weather along the drive: its sky, the temperature, and the wind. */
function DriveWeather(props: { drive: DriveDetailDto }) {
  const u = useUnits();
  const d = props.drive;
  const w = d.weather;
  const tempC = d.outsideTempC ?? (w ? (w.minC + w.maxC) / 2 : null);
  if (!w && tempC == null) return null;
  const lat = d.startLat ?? d.points[0]?.lat;
  const lon = d.startLon ?? d.points[0]?.lon;
  const night = lat != null && lon != null && !isDaytime(lat, lon, Date.parse(d.startedAt));
  const condition = w?.weatherCode != null ? weatherLabel(w.weatherCode) : null;
  const windFrom = w?.windFromDeg != null ? compass(w.windFromDeg) : null;
  const range =
    w && u.temperature(w.maxC)! - u.temperature(w.minC)! >= 2
      ? `${u.formatTemperature(w.minC)} to ${u.formatTemperature(w.maxC)} along the way`
      : null;
  const wind =
    w?.windKmh != null
      ? `Wind ${u.formatSpeed(w.windKmh)}${windFrom ? ` from the ${windFrom}` : ''}`
      : null;
  return (
    <div
      className="flex shrink-0 items-center gap-2 sm:gap-3"
      title={[condition, range, wind].filter(Boolean).join(' · ')}
    >
      {w?.weatherCode != null && (
        <WeatherIcon
          kind={weatherKind(w.weatherCode)}
          night={night}
          label={condition ?? undefined}
          className="size-6 text-(--text-secondary) sm:size-9"
        />
      )}
      <div className="flex items-baseline gap-2 sm:block sm:text-right">
        <div className="text-sm font-semibold tabular-nums sm:text-base lg:text-xl">
          {u.formatTemperature(tempC)}
        </div>
        {w?.windKmh != null && (
          <div className="flex items-center gap-1 text-xs text-(--text-muted) tabular-nums sm:justify-end">
            {w.windFromDeg != null && <WindArrow fromDeg={w.windFromDeg} className="size-3.5" />}
            {u.formatSpeed(w.windKmh)}
            {windFrom && ` ${windFrom}`}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A saved location's name or a short address, with the full address on
 * hover. On a phone it wraps rather than being cut short.
 */
function Place(props: { place: DrivePlaceDto | null }) {
  if (!props.place) return <span className="text-(--text-muted)">Unknown</span>;
  return (
    <span
      className="min-w-0 break-words sm:truncate"
      title={props.place.address ?? props.place.label}
    >
      <PlaceIcon isHome={props.place.isHome} saved={props.place.locationId != null} />
      {props.place.label}
    </span>
  );
}
