import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { isTeslaMateVehicle } from '@server/teslamate/ids';
import { useMemo, useState } from 'react';
import { api } from '../../api/client';
import { useChargingSessions, useDriveCoverage, useDrives } from '../../api/hooks';
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
import { RANGES } from './options';
import { PlacesPanel } from './PlacesPanel';
import { RhythmPanel } from './RhythmPanel';
import { Segmented } from './Segmented';
import { SummaryCard } from './SummaryCard';
import { Timeline } from './Timeline';
import { TimeSpent } from './TimeSpent';

const MAP_HEIGHT = '30rem';

export function HistoryPage(props: { vehicleId: string }) {
  const [rangeIdx, setRangeIdx] = useState(1);
  const range = RANGES[rangeIdx] ?? RANGES[1]!;
  const { from, to } = useMemo(() => rangeWindow(range.hours, new Date()), [range.hours]);

  // Everything in the window, not just the newest few hundred.
  const { data: drives, isPending: drivesPending } = useDrives(props.vehicleId, from);
  const { data: sessions, isPending: sessionsPending } = useChargingSessions(props.vehicleId, from);
  const { data: coverage } = useDriveCoverage(props.vehicleId);
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
  const { data: chargeSpans, isPending: chargeSpansPending } = useQuery({
    queryKey: ['chargeSpans', props.vehicleId, range.label],
    queryFn: () => api.chargeSpans(props.vehicleId, from, to),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  const { data: stateSpans, isPending: stateSpansPending } = useQuery({
    queryKey: ['stateSpans', props.vehicleId, range.label],
    queryFn: () => api.stateSpans(props.vehicleId, from, to),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  const { data: trail, isPending: trailPending } = useQuery({
    queryKey: ['locations', props.vehicleId, range.label],
    queryFn: () => api.locations(props.vehicleId, from, to),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

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
          <Segmented
            label="Period"
            size="md"
            items={RANGES.map((r) => r.label)}
            value={rangeIdx}
            onChange={setRangeIdx}
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
            weather={!isTeslaMateVehicle(props.vehicleId)}
          />
        </section>
      </div>
    </>
  );
}
