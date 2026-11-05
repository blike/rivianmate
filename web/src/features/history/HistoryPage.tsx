import { keepPreviousData, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { isTeslaMateVehicle } from '@server/teslamate/ids';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import {
  chargingSessionsQuery,
  drivesQuery,
  useChargingSessions,
  useDriveCoverage,
  useDrives,
  useLookupSettings,
} from '../../api/hooks';
import { ContentFrame, LoadingScope } from '../../components/LoadingState';
import { PageHeader, SectionRule } from '../../components/PageHeader';
import { TRIPS_LEGEND, VehicleMap } from '../../components/VehicleMap';
import { isPosition } from '../../lib/geo';
import { EfficiencyPanel } from './EfficiencyPanel';
import { EnergyPanel } from './EnergyPanel';
import {
  activityBands,
  periodSummary,
  positionAt,
  rangeWindow,
  stateRows,
  tripLines,
} from './history';
import {
  DEFAULT_RANGE,
  neighbours,
  PREFETCH_FRESH_MS,
  type Range,
  type RangeLabel,
  RANGES,
  rangeOf,
} from './options';
import { PlacesPanel } from './PlacesPanel';
import { RhythmPanel } from './RhythmPanel';
import { Select } from '../../components/Select';
import { SummaryCard } from './SummaryCard';
import { Timeline } from './Timeline';
import { TimeSpent } from './TimeSpent';

const MAP_HEIGHT = '30rem';

type Window = { from: Date; to: Date };

const chargeSpansQuery = (vehicleId: string, range: Range, w: Window) =>
  queryOptions({
    queryKey: ['chargeSpans', vehicleId, range.label],
    queryFn: () => api.chargeSpans(vehicleId, w.from, w.to),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

const stateSpansQuery = (vehicleId: string, range: Range, w: Window) =>
  queryOptions({
    queryKey: ['stateSpans', vehicleId, range.label],
    queryFn: () => api.stateSpans(vehicleId, w.from, w.to),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

const locationsQuery = (vehicleId: string, range: Range, w: Window) =>
  queryOptions({
    queryKey: ['locations', vehicleId, range.label],
    queryFn: () => api.locations(vehicleId, w.from, w.to),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

export function HistoryPage(props: { vehicleId: string }) {
  const [rangeLabel, setRangeLabel] = useState<RangeLabel>(DEFAULT_RANGE);
  const range = rangeOf(rangeLabel);
  const { from, to } = useMemo(() => rangeWindow(range.hours, new Date()), [range.hours]);

  // Everything in the window, not just the newest few hundred.
  const drivesResult = useDrives(props.vehicleId, from);
  const sessionsResult = useChargingSessions(props.vehicleId, from);
  const { data: drives, isPending: drivesPending } = drivesResult;
  const { data: sessions, isPending: sessionsPending } = sessionsResult;
  const { data: coverage } = useDriveCoverage(props.vehicleId);
  const { data: lookups } = useLookupSettings();
  // The battery over the energy ledger's period, which starts no earlier than the drives
  // and ends where the ledger does.
  const drivesSince = coverage?.since;
  const balanceFrom = useMemo(() => {
    const since = drivesSince ? new Date(drivesSince) : null;
    return since && since > from ? since : from;
  }, [drivesSince, from]);
  const { data: battery } = useQuery({
    queryKey: ['batteryWindow', props.vehicleId, balanceFrom.toISOString(), to.toISOString()],
    queryFn: () => api.batteryWindow(props.vehicleId, balanceFrom, to),
    enabled: coverage !== undefined,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  const chargeSpansResult = useQuery(chargeSpansQuery(props.vehicleId, range, { from, to }));
  const stateSpansResult = useQuery(stateSpansQuery(props.vehicleId, range, { from, to }));
  const trailResult = useQuery(locationsQuery(props.vehicleId, range, { from, to }));
  const { data: chargeSpans, isPending: chargeSpansPending } = chargeSpansResult;
  const { data: stateSpans, isPending: stateSpansPending } = stateSpansResult;
  const { data: trail, isPending: trailPending } = trailResult;

  // Once the period shown has loaded, load the ones either side of it
  // behind it, so switching to one shows it straight away rather than the
  // last one's.
  const queryClient = useQueryClient();
  const shownLoaded = [
    drivesResult,
    sessionsResult,
    chargeSpansResult,
    stateSpansResult,
    trailResult,
  ].every((q) => q.isSuccess && !q.isPlaceholderData);
  useEffect(() => {
    if (!shownLoaded) return;
    const now = new Date();
    for (const other of neighbours(range)) {
      const w = rangeWindow(other.hours, now);
      const fresh = { staleTime: PREFETCH_FRESH_MS };
      void queryClient.query({ ...drivesQuery(props.vehicleId, w.from), ...fresh }).catch(() => {});
      void queryClient
        .query({
          ...chargingSessionsQuery(props.vehicleId, w.from),
          ...fresh,
        })
        .catch(() => {});
      void queryClient
        .query({ ...chargeSpansQuery(props.vehicleId, other, w), ...fresh })
        .catch(() => {});
      void queryClient
        .query({ ...stateSpansQuery(props.vehicleId, other, w), ...fresh })
        .catch(() => {});
      void queryClient
        .query({ ...locationsQuery(props.vehicleId, other, w), ...fresh })
        .catch(() => {});
    }
  }, [shownLoaded, range, props.vehicleId, queryClient]);

  const fixes = useMemo(
    () =>
      (trail ?? [])
        .filter((p) => isPosition(p.lat, p.lon))
        .map((p) => ({ ts: Date.parse(p.ts), lat: p.lat, lon: p.lon })),
    [trail],
  );
  const trips = useMemo(
    () => tripLines((trail ?? []).filter((p) => isPosition(p.lat, p.lon))),
    [trail],
  );
  const lastPosition = fixes.at(-1);
  // Hovering the timeline marks where the vehicle was at that moment.
  const [hoverTs, setHoverTs] = useState<number | null>(null);
  const hoverPosition = hoverTs != null ? positionAt(fixes, hoverTs) : null;

  const activityPending = drivesPending || sessionsPending;
  const summary = useMemo(
    () => periodSummary(drives ?? [], sessions ?? [], from.getTime(), to.getTime()),
    [drives, sessions, from, to],
  );
  const bands = useMemo(
    () => activityBands(drives ?? [], chargeSpans ?? [], from.getTime(), to.getTime()),
    [drives, chargeSpans, from, to],
  );
  const segments = useMemo(
    () => stateRows(stateSpans ?? [], from.getTime(), to.getTime(), false)[0]?.segments ?? [],
    [stateSpans, from, to],
  );

  return (
    <>
      <PageHeader
        kicker={`Last ${range.title}`}
        title="History"
        action={
          <Select
            label="Period"
            value={rangeLabel}
            options={RANGES.map((r) => ({ value: r.label, label: r.title }))}
            widthOf={RANGES.map((r) => r.title)}
            onChange={setRangeLabel}
          />
        }
      />

      <div className="space-y-10">
        <div className="space-y-4">
          <LoadingScope loading={activityPending}>
            <SummaryCard
              summary={summary}
              drives={drives ?? []}
              from={from}
              to={to}
              hours={range.hours}
            />
          </LoadingScope>

          <Timeline
            vehicleId={props.vehicleId}
            range={range}
            from={from}
            to={to}
            bands={drivesPending || chargeSpansPending ? [] : bands}
            segments={segments}
            onHover={setHoverTs}
          />
        </div>

        <section>
          <SectionRule>Where and when</SectionRule>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <section className="card flex flex-col overflow-hidden xl:col-span-8">
              <div className="flex items-center justify-between gap-4 px-5 pt-5 pb-4 sm:px-6">
                <h2 className="eyebrow text-(--text-secondary)">Routes driven</h2>
                <span className="flex items-center gap-2 text-xs text-(--text-muted)">
                  Once
                  <span className="h-1.5 w-16 rounded-full" style={{ background: TRIPS_LEGEND }} />
                  Often
                </span>
              </div>
              {/* Fills the card, as tall as the time spent beside it. */}
              <div
                className="overview-map relative flex-1 border-t border-(--hairline)"
                style={{ minHeight: MAP_HEIGHT }}
              >
                <div className="absolute inset-0">
                  <ContentFrame
                    height="100%"
                    loading={trailPending}
                    empty={fixes.length === 0}
                    emptyText="No location points in this period."
                  >
                    {lastPosition && (
                      <VehicleMap
                        lat={lastPosition.lat}
                        lon={lastPosition.lon}
                        trips={trips}
                        variant="history"
                        height="100%"
                        follow={false}
                        highlight={hoverPosition}
                      />
                    )}
                  </ContentFrame>
                </div>
              </div>
            </section>
            <div className="xl:col-span-4">
              <TimeSpent
                spans={stateSpans}
                loading={stateSpansPending}
                from={from}
                to={to}
                hours={range.hours}
              />
            </div>
            <div className="xl:col-span-7">
              <RhythmPanel drives={drives} loading={drivesPending} from={from} to={to} />
            </div>
            <div className="xl:col-span-5">
              <PlacesPanel drives={drives} loading={drivesPending} from={from} to={to} />
            </div>
          </div>
        </section>

        <section>
          <SectionRule>Energy</SectionRule>
          <EnergyPanel
            drives={drives}
            sessions={sessions}
            drivesSince={coverage?.since ?? null}
            battery={battery}
            loading={activityPending}
            from={from}
            to={to}
          />
        </section>

        <section>
          <SectionRule>Efficiency</SectionRule>
          <EfficiencyPanel
            drives={drives}
            loading={drivesPending}
            weather={
              isTeslaMateVehicle(props.vehicleId)
                ? 'none'
                : lookups?.weather === false
                  ? 'off'
                  : 'on'
            }
          />
        </section>
      </div>
    </>
  );
}
