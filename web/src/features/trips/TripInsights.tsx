import { useMemo } from 'react';
import type { TripDetailDto, TripRouteDto } from '../../api/client';
import { useUnits } from '../../api/hooks';
import { SectionRule } from '../../components/PageHeader';
import { Panel } from '../../components/Panel';
import { TrendChart } from '../../components/TrendChart';
import { WeatherIcon } from '../../components/WeatherIcon';
import { plural, shortDate } from '../../lib/format';
import { fmt, fmtSeconds } from '../../lib/state';
import { weatherKind, weatherLabel } from '../../lib/weather';
import {
  daySummaries,
  driverSplit,
  bridgeGaps,
  roadProfile,
  timeSplit,
  totalClimbM,
  totalDescentM,
  stayRoute,
  tripFacts,
  tripStays,
} from './insights';
import { dayColor } from './journey';
import { StaysPanel } from './Stays';
import { dayLabel, openPhase } from './trips';

const TIME_COLORS = {
  driving: 'var(--series-1)',
  charging: 'var(--accent)',
  parked: 'var(--surface-3)',
  missing: 'var(--text-muted)',
};

/** Drivers in fixed order; beyond these, colors would have to repeat. */
const DRIVER_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

/** The journey read back: what stands out, the charts, and day by day. */
export function TripInsights(props: {
  trip: TripDetailDto;
  routes: TripRouteDto[] | undefined;
  focusDay: string | null;
  onFocusDay: (day: string | null) => void;
}) {
  const { trip, routes } = props;
  const u = useUnits();
  const facts = useMemo(() => tripFacts(trip, routes ?? [], u), [trip, routes, u]);
  const road = useMemo(() => roadProfile(trip.drives, trip.sessions, routes ?? []), [trip, routes]);
  const split = timeSplit(trip);
  const drivers = useMemo(() => {
    // Past the colors there are, the rest share one rather than repeat one.
    const shares = driverSplit(trip.drives);
    const named = shares.filter((d) => d.name != null);
    const rest = named.slice(DRIVER_COLORS.length);
    const others = rest.reduce(
      (sum, d) => ({
        ...sum,
        distanceKm: sum.distanceKm + d.distanceKm,
        seconds: sum.seconds + d.seconds,
        drives: sum.drives + d.drives,
      }),
      { name: 'Other drivers', distanceKm: 0, seconds: 0, drives: 0 },
    );
    return [
      ...named.slice(0, DRIVER_COLORS.length).map((d, i) => ({ ...d, color: DRIVER_COLORS[i]! })),
      ...(rest.length ? [{ ...others, color: 'var(--text-muted)' }] : []),
      ...shares.filter((d) => d.name == null).map((d) => ({ ...d, color: TIME_COLORS.parked })),
    ];
  }, [trip]);
  const days = useMemo(() => daySummaries(trip.drives, trip.sessions), [trip]);
  const roadData = useMemo(() => {
    const km = road.points.map((p) => u.distance(p.km) ?? 0);
    const elevation = road.points.map((p) =>
      p.elevationM == null ? null : (u.elevation(p.elevationM) ?? null),
    );
    const bridged = bridgeGaps(km, elevation);
    const batteryBridged = bridgeGaps(
      km,
      road.points.map((p) => p.battery),
    );
    return road.points.map((p, i) => ({
      km: km[i]!,
      elevation: elevation[i]!,
      noRoute: bridged[i]!,
      battery: p.battery,
      noBattery: batteryBridged[i]!,
    }));
  }, [road, u]);
  if (trip.stats.drives + trip.stats.charges === 0) return null;
  const climb = totalClimbM(trip.drives);
  const descent = totalDescentM(trip.drives);
  // The axis marks where each day's driving began, and says which day it is.
  const roadDays = road.days.map((d) => ({
    at: u.distance(d.km) ?? 0,
    label: dayLabel(d.key),
  }));
  const distanceLabel = (v: number) => `${fmt(v, 0)} ${u.distanceUnit}`;
  const dayOf = (v: number) => [...roadDays].reverse().find((d) => d.at <= v)?.label;
  const roadAxis = {
    data: roadData,
    xKey: 'km',
    syncId: `road-${trip.id}`,
    yAxisWidth: 52,
    xTicks: roadDays.length > 1 ? roadDays.map((d) => d.at) : undefined,
    xFormatter: (v: number) =>
      roadDays.length > 1 ? (roadDays.find((d) => d.at === v)?.label ?? '') : distanceLabel(v),
    tooltipLabel: (v: number) =>
      [`${distanceLabel(v)} in`, roadDays.length > 1 && dayOf(v)].filter(Boolean).join(' · '),
  };
  const hasBattery = road.points.some((p) => p.battery != null);

  const route = stayRoute(trip.drives, tripStays(trip.drives, trip.sessions));
  const stays = route.filter((p) => p.kind === 'stay').length >= 2 && (
    <StaysPanel
      route={route}
      underWay={openPhase(trip)?.kind === 'live'}
      driven={new Set(days.map((d) => d.key))}
      focusDay={props.focusDay}
      onFocusDay={props.onFocusDay}
    />
  );
  const side = [
    split && (
      <Panel key="time" title="Where the time went">
        <p className="readout text-[2rem] font-semibold">{fmtSeconds(split.totalS)}</p>
        <ShareBar
          format={fmtSeconds}
          segments={[
            {
              key: 'driving',
              label: 'Driving',
              value: split.drivingS,
              color: TIME_COLORS.driving,
            },
            {
              key: 'charging',
              label: 'Charging',
              value: split.chargingS,
              color: TIME_COLORS.charging,
            },
            {
              key: 'missing',
              label: 'Not in this trip',
              detail: 'between drives that don’t meet',
              value: split.missingS,
              color: TIME_COLORS.missing,
            },
            {
              key: 'parked',
              label: 'Everything else',
              value: split.parkedS,
              color: TIME_COLORS.parked,
            },
          ]}
        />
      </Panel>
    ),
    drivers.length > 0 && (
      <Panel key="drivers" title="Who drove">
        <ShareBar
          format={(km) => u.formatDistance(km)}
          segments={drivers.map((d) => ({
            key: d.name ?? '',
            label: d.name ?? 'Not recorded',
            value: d.distanceKm,
            detail: `${plural(d.drives, 'drive')} · ${fmtSeconds(d.seconds)}`,
            color: d.color,
          }))}
        />
      </Panel>
    ),
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <SectionRule>Insights</SectionRule>

      {days.length > 1 && (
        <Panel title="Day by day">
          <ul className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-1">
            {days.map((d, i) => (
              <li key={d.key} className="w-56 shrink-0 snap-start">
                <button
                  type="button"
                  aria-pressed={props.focusDay === d.key}
                  onClick={() => props.onFocusDay(props.focusDay === d.key ? null : d.key)}
                  className={`flex h-full w-full flex-col rounded-xl border p-3.5 text-left transition-colors hover:bg-(--surface-2) ${
                    props.focusDay === d.key
                      ? 'border-(--text-muted) bg-(--surface-2)'
                      : 'border-(--border)'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-xs text-(--text-muted)">
                      <span
                        aria-hidden
                        className="size-2 rounded-full"
                        style={{ background: dayColor(i, days.length) }}
                      />
                      {shortDate(d.at)}
                    </span>
                    {d.weather?.weatherCode != null && (
                      <span className="flex items-center gap-1 text-xs text-(--text-secondary) tabular-nums">
                        <WeatherIcon
                          kind={weatherKind(d.weather.weatherCode)}
                          label={weatherLabel(d.weather.weatherCode)}
                          className="size-4"
                        />
                        {u.formatTemperature(d.tempC)}
                      </span>
                    )}
                  </div>
                  <div className="readout mt-2 text-xl font-semibold">
                    {d.distanceKm > 0 ? u.formatDistance(d.distanceKm) : 'Parked'}
                  </div>
                  {/* Where from, then where to beneath: two lines always, so the cards match. */}
                  <p className="mt-1 text-xs text-(--text-secondary)">
                    <span className="block truncate">{d.from ?? '\u00a0'}</span>
                    <span className="block truncate">
                      {d.from && d.to && d.from !== d.to ? `→ ${d.to}` : '\u00a0'}
                    </span>
                  </p>
                  <p className="mt-2 text-xs text-(--text-muted) tabular-nums">
                    {[
                      d.drives.length > 0 && plural(d.drives.length, 'drive'),
                      d.sessions.length > 0 && `${fmt(d.energyAddedKwh, 0)} kWh charged`,
                      d.cost,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {facts.length > 0 && (
        // As many columns as fit, so a wide screen takes the facts in one row.
        <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-(--hairline) bg-(--hairline) sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
          {facts.map((f) => (
            <li key={f.key} className="bg-(--surface-1) px-5 py-4">
              <div className="eyebrow">{f.label}</div>
              <div className="readout mt-2 text-2xl font-semibold">{f.value}</div>
              {f.sub && (
                <div className="mt-1 truncate text-xs text-(--text-secondary) tabular-nums">
                  {f.sub}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {road.points.length >= 2 && (road.hasElevation || hasBattery) && (
        <Panel title="Along the way">
          {road.hasElevation && (
            <>
              <ChartLabel
                label="Elevation"
                aside={[
                  climb > 0 && `${u.formatElevation(climb)} climbed`,
                  descent > 0 && `${u.formatElevation(descent)} descended`,
                  road.unmappedKm >= 1 && `no route for ${u.formatDistance(road.unmappedKm)}`,
                  road.missingKm >= 1 && `~${u.formatDistance(road.missingKm)} not in trip`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <TrendChart
                {...roadAxis}
                height={170}
                hideXAxis={hasBattery}
                series={[
                  {
                    key: 'elevation',
                    label: 'Elevation',
                    color: 'var(--series-1)',
                    unit: u.elevationUnit,
                    digits: 0,
                    interpolation: 'linear',
                    connectNulls: false,
                  },
                  {
                    key: 'noRoute',
                    label: 'No route',
                    color: 'var(--text-muted)',
                    mark: 'line',
                    dashed: true,
                    quiet: true,
                    interpolation: 'linear',
                    connectNulls: false,
                  },
                ]}
              />
            </>
          )}
          {hasBattery && (
            <>
              <ChartLabel label="Battery" className={road.hasElevation ? 'mt-4' : ''} />
              <TrendChart
                {...roadAxis}
                height={road.hasElevation ? 150 : 200}
                leftDomain={[0, 100]}
                leftUnit="%"
                series={[
                  {
                    key: 'battery',
                    label: 'Battery',
                    color: 'var(--series-2)',
                    unit: '%',
                    digits: 0,
                    interpolation: 'linear',
                    connectNulls: false,
                  },
                  {
                    // Across what wasn't read: driving not in the trip, or no level reported.
                    key: 'noBattery',
                    label: 'Not read',
                    color: 'var(--text-muted)',
                    mark: 'line',
                    dashed: true,
                    quiet: true,
                    interpolation: 'linear',
                    connectNulls: false,
                  },
                ]}
              />
            </>
          )}
        </Panel>
      )}

      {/* Where it stayed, tall, beside the rest; without it, the rest side by side. */}
      {stays ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {stays}
          {side.length > 0 && <div className="space-y-4">{side}</div>}
        </div>
      ) : (
        side.length > 0 && (
          <div
            className={`grid grid-cols-1 items-start gap-4 ${side.length > 1 ? 'lg:grid-cols-2' : ''}`}
          >
            {side}
          </div>
        )
      )}
    </div>
  );
}

/** How a whole splits up, as one bar and a legend with each part's figure and share. */
function ShareBar(props: {
  format: (value: number) => string;
  segments: { key: string; label: string; value: number; color: string; detail?: string }[];
}) {
  const segments = props.segments.filter((s) => s.value > 0);
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;
  return (
    <>
      <div
        role="img"
        aria-label={segments.map((s) => `${s.label} ${props.format(s.value)}`).join(', ')}
        className="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full"
      >
        {segments.map((s) => (
          <div
            key={s.key}
            title={`${s.label}: ${props.format(s.value)}`}
            style={{ flexGrow: s.value / total, flexBasis: 0, background: s.color }}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-(--text-secondary)">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: s.color }}
              />
              <span className="truncate">{s.label}</span>
              {s.detail && (
                <span className="hidden truncate text-xs text-(--text-muted) sm:inline">
                  {s.detail}
                </span>
              )}
            </span>
            <span className="shrink-0 tabular-nums">
              {props.format(s.value)}
              <span className="ml-2 text-(--text-muted)">{fmt((s.value / total) * 100, 0)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** A stacked chart's name, and a figure about it to the side. */
function ChartLabel(props: { label: string; aside?: string; className?: string }) {
  return (
    <div
      className={`mb-1 flex items-baseline justify-between gap-3 text-xs ${props.className ?? ''}`}
    >
      <span className="font-medium text-(--text-secondary)">{props.label}</span>
      {props.aside && <span className="text-(--text-muted) tabular-nums">{props.aside}</span>}
    </div>
  );
}
