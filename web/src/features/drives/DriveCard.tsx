import type { DriveDetailDto, DrivePlaceDto } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { InProgressTag } from '../../components/InProgressTag';
import { PlaceIcon } from '../../components/PlaceIcon';
import { Skeleton, useLoading } from '../../components/LoadingState';
import { type StatTile, StatTiles } from '../../components/StatTiles';
import { averageSpeedKmh, rangeUsedKm } from '../../lib/drives';
import { clock, longDay } from '../../lib/format';
import { fmt, fmtDuration, titleCase } from '../../lib/state';
import { WeatherIcon, WindArrow } from '../../components/WeatherIcon';
import { compass, isDaytime, weatherKind, weatherLabel } from '../../lib/weather';

/** The chosen drive: where it went up front, then its figures. */
export function DriveCard(props: { drive: DriveDetailDto | undefined }) {
  const u = useUnits();
  const loading = useLoading();
  const d = props.drive;
  const live = d != null && !d.endedAt;
  const rangeUsed = d ? rangeUsedKm(d.startRangeKm, d.endRangeKm) : null;
  const avgSpeed = d ? averageSpeedKmh(d.distanceKm, d.startedAt, d.endedAt) : null;
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
      sub: avgSpeed != null ? `${u.formatSpeed(avgSpeed)} average` : undefined,
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

  return (
    <section className="card overflow-hidden">
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-(--text-muted)">
            {loading || !d ? (
              <Skeleton className="w-[14em]" />
            ) : (
              <>
                <span>
                  {longDay(d.startedAt)} · {clock(d.startedAt)}
                  {d.endedAt ? ` – ${clock(d.endedAt)}` : ' – now'}
                </span>
                {live && <InProgressTag />}
              </>
            )}
          </div>
          <h2 className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 text-base lg:text-xl font-semibold tracking-tight">
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
        </div>
        {d && !loading && <DriveWeather drive={d} />}
      </div>
      <StatTiles tiles={tiles} columns="sm:grid-cols-3 lg:grid-cols-6" />
    </section>
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
      className="flex shrink-0 items-center gap-3"
      title={[condition, range, wind].filter(Boolean).join(' · ')}
    >
      {w?.weatherCode != null && (
        <WeatherIcon
          kind={weatherKind(w.weatherCode)}
          night={night}
          label={condition ?? undefined}
          className="size-9 text-(--text-secondary)"
        />
      )}
      <div className="text-right">
        <div className="text-base lg:text-xl font-semibold tabular-nums">
          {u.formatTemperature(tempC)}
        </div>
        {w?.windKmh != null && (
          <div className="flex items-center justify-end gap-1 text-xs text-(--text-muted) tabular-nums">
            {w.windFromDeg != null && <WindArrow fromDeg={w.windFromDeg} className="size-3.5" />}
            {u.formatSpeed(w.windKmh)}
            {windFrom && ` ${windFrom}`}
          </div>
        )}
      </div>
    </div>
  );
}

/** A saved location's name or a short address, with the full address on hover. */
function Place(props: { place: DrivePlaceDto | null }) {
  if (!props.place) return <span className="text-(--text-muted)">Unknown</span>;
  return (
    <span className="min-w-0 truncate" title={props.place.address ?? props.place.label}>
      <PlaceIcon isHome={props.place.isHome} saved={props.place.locationId != null} />
      {props.place.label}
    </span>
  );
}
