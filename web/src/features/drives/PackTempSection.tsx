import { useMemo } from 'react';
import { isTeslaMateVehicle } from '@server/teslamate/ids';
import { type PackTempSpan, useInsights, usePackTemps, useUnits } from '../../api/hooks';
import { ContentFrame, Skeleton } from '../../components/LoadingState';
import { PanelSection } from '../../components/Panel';
import { TrendChart } from '../../components/TrendChart';
import { minuteTicks } from '../../lib/drives';
import { showParallaxOnly } from '../../lib/fieldSources';
import { clock } from '../../lib/format';
import { packReadings } from '../../lib/packTemperature';
import { packTempAxis, packTempTicks } from '../../lib/packTempAxis';
import { fmtSeconds } from '../../lib/state';
import { formatMinutes, tooltipTime } from './format';
import {
  packTempChangeText,
  packTempChartSeries,
  packTempFigures,
  packTempSeries,
  packTempText,
} from './packTemp';

/**
 * The pack's temperature over a span: what it read at each end and how far it
 * moved, over the average with the coldest and hottest cell shaded around it.
 * A drive moves the pack only a degree or three, and so does a charge, so the
 * figures carry what a curve this flat can't. Where a vehicle reports the
 * readings at all, they arrive only while it's awake and only when they move, so
 * the series carries a row per heartbeat and breaks where the heartbeats stop:
 * the line and the band stop and pick up again rather than being drawn across a
 * silence.
 *
 * The drive page draws it under the drive's speed and elevation, and the charge
 * page under the charging curve: the same readings, the same chart, the same
 * axis framing.
 */
export function PackTempSection(props: {
  vehicleId: string;
  /**
   * The span to chart and what it is, as the copy names it: a drive, or a
   * charge. A span still under way has no end, so its line runs to its latest
   * reading.
   */
  span: PackTempSpan | undefined;
  loading: boolean;
}) {
  const u = useUnits();
  const span = props.span;
  const { data: history, isPending } = usePackTemps(props.vehicleId, span);
  // Why an empty frame is empty is not always the awake case: TeslaMate never
  // sends these fields, and neither does a vehicle that has never sent one.
  const { data: insights } = useInsights(props.vehicleId);
  const reports = !isTeslaMateVehicle(props.vehicleId) && showParallaxOnly(insights, 'cellTemps');
  const readings = useMemo(() => packReadings(history ?? []), [history]);
  const startMs = span ? Date.parse(span.from) : 0;
  // A span under way has no end yet, so its line runs to its latest reading.
  const live = span != null && span.to == null;
  const endedAt = span?.to ? Date.parse(span.to) : null;
  const endMs = endedAt ?? (span ? (readings.at(-1)?.at ?? startMs) : 0);

  const figures = useMemo(
    () => packTempFigures(readings, { startMs, endMs, live }),
    [readings, startMs, endMs, live],
  );
  const rows = useMemo(
    () => packTempSeries(readings, { startMs, endMs, toDisplay: u.temperature }),
    [readings, startMs, endMs, u],
  );
  // Framed around the readings rather than fitted to them, so a span that barely
  // moves the pack doesn't draw as a band filling the plot, and ticked at a step
  // the frame's span picks rather than at whatever its ends imply.
  const domain = useMemo(
    () =>
      packTempAxis(
        rows.flatMap((row) => [row.avg, row.min, row.max]).filter((v): v is number => v != null),
        u.units.temperature,
      ),
    [rows, u],
  );
  const ticks = useMemo(() => packTempTicks(domain, u.units.temperature), [domain, u]);
  const spanName = span?.kind === 'charge' ? 'charge' : 'drive';
  const loading = props.loading || isPending;
  const series = packTempChartSeries(u);
  const total = (endMs - startMs) / 60_000;
  // A change needs two readings, at two ends of the span.
  const { startAt, endAt } = figures;
  const changeSub =
    startAt != null && endAt != null && endAt > startAt
      ? `over ${fmtSeconds((endAt - startAt) / 1000)}`
      : 'Needs both';

  return (
    <PanelSection title="Pack temperature">
      <dl className="grid grid-cols-3 gap-4">
        <Figure
          label="At start"
          loading={loading}
          value={packTempText(u, figures.startC)}
          sub={startAt == null ? 'Not recorded' : clock(startAt)}
        />
        <Figure
          label="At end"
          loading={loading}
          value={packTempText(u, figures.endC)}
          sub={endAt == null ? 'Not recorded' : clock(endAt)}
        />
        <Figure
          label="Change"
          loading={loading}
          value={packTempChangeText(u, figures.changeC)}
          sub={changeSub}
        />
      </dl>
      <div className="mt-4">
        <ContentFrame
          height={150}
          loading={loading}
          empty={rows.length === 0}
          emptyText={
            readings.length === 0
              ? `No pack temperature was recorded on this ${spanName}: ${
                  reports
                    ? 'the vehicle reports it only while it’s awake.'
                    : 'it isn’t reported for this vehicle.'
                }`
              : `One pack temperature reading was recorded on this ${spanName}, and one is no trend to draw.`
          }
        >
          <TrendChart
            data={rows}
            xKey="minutes"
            height={150}
            xTicks={minuteTicks(0, total)}
            xFormatter={formatMinutes(total)}
            tooltipLabel={span ? tooltipTime(span.from) : undefined}
            leftDomain={domain}
            leftTicks={ticks}
            leftUnit={u.temperatureUnit}
            series={series}
          />
        </ContentFrame>
      </div>
    </PanelSection>
  );
}

/** A label, its figure and a line under it, as a card's tiles are drawn. */
function Figure(props: { label: string; value: string; sub: string; loading: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-(--text-muted)">{props.label}</dt>
      <dd className="mt-1">
        <div className="text-base font-semibold tabular-nums">
          {props.loading ? <Skeleton className="w-[4em]" /> : props.value}
        </div>
        <div className="truncate text-xs text-(--text-secondary)" title={props.sub}>
          {props.loading ? <Skeleton className="w-[5em]" /> : props.sub}
        </div>
      </dd>
    </div>
  );
}
