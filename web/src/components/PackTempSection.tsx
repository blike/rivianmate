import { useMemo } from 'react';
import { isTeslaMateVehicle } from '@server/teslamate/ids';
import { type PackTempSpan, useInsights, usePackTemps, useUnits } from '../api/hooks';
import { formatMinutes, minuteTicks, tooltipTime } from '../lib/drives';
import { showParallaxOnly } from '../lib/fieldSources';
import { clock } from '../lib/format';
import {
  packReadings,
  packTempChangeText,
  packTempChartSeries,
  packTempFigures,
  packTempSeries,
  packTempText,
} from '../lib/packTemperature';
import { packTempAxis, packTempTicks } from '../lib/packTempAxis';
import { fmtSeconds } from '../lib/state';
import { ContentFrame, LoadingScope } from './LoadingState';
import { PanelSection } from './Panel';
import { StatTiles } from './StatTiles';
import { STACKED_AXIS_WIDTH, TrendChart } from './TrendChart';

/**
 * The pack's temperature over a drive or charge: the reading at each end, the
 * change, and a chart of the average with the coldest-to-hottest band.
 */
export function PackTempSection(props: {
  vehicleId: string;
  /** The drive or charge; `to` is null while it's under way. */
  span: PackTempSpan | undefined;
  loading: boolean;
  /** The x values (minutes) of the chart above, to line up and share the pointer with it. */
  minutes?: readonly number[];
  syncId?: string;
}) {
  const u = useUnits();
  const span = props.span;
  const { data: history, isPending } = usePackTemps(props.vehicleId, span);
  // Says why an empty chart is empty: not reported at all, or only while awake.
  const { data: insights } = useInsights(props.vehicleId);
  const reports = !isTeslaMateVehicle(props.vehicleId) && showParallaxOnly(insights, 'cellTemps');
  const readings = useMemo(() => packReadings(history ?? []), [history]);
  const startMs = span ? Date.parse(span.from) : 0;
  const live = span != null && span.to == null;
  const endedAt = span?.to ? Date.parse(span.to) : null;
  const endMs = endedAt ?? (span ? (readings.at(-1)?.at ?? startMs) : 0);

  const figures = useMemo(
    () => packTempFigures(readings, { startMs, endMs, live }),
    [readings, startMs, endMs, live],
  );
  const rows = useMemo(
    () =>
      packTempSeries(readings, {
        startMs,
        endMs,
        minutes: props.minutes,
        toDisplay: u.temperature,
      }),
    [readings, startMs, endMs, props.minutes, u],
  );
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
  const first = rows[0]?.minutes ?? 0;
  const total = rows.at(-1)?.minutes ?? (endMs - startMs) / 60_000;
  const { startAt, endAt } = figures;
  const changeSub =
    startAt != null && endAt != null && endAt > startAt
      ? `over ${fmtSeconds((endAt - startAt) / 1000)}`
      : 'Needs both';

  return (
    <PanelSection title="Pack temperature">
      <LoadingScope loading={loading}>
        <StatTiles
          columns="sm:grid-cols-3"
          tiles={[
            {
              label: 'At start',
              value: packTempText(u, figures.startC),
              sub: startAt == null ? 'Not recorded' : clock(startAt),
            },
            {
              label: 'At end',
              value: packTempText(u, figures.endC),
              sub: endAt == null ? 'Not recorded' : clock(endAt),
            },
            { label: 'Change', value: packTempChangeText(u, figures.changeC), sub: changeSub },
          ]}
        />
      </LoadingScope>
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
            xTicks={minuteTicks(first, total)}
            xFormatter={formatMinutes(total)}
            tooltipLabel={span ? tooltipTime(span.from) : undefined}
            leftDomain={domain}
            leftTicks={ticks}
            leftUnit={u.temperatureUnit}
            series={series}
            syncId={props.syncId}
            yAxisWidth={STACKED_AXIS_WIDTH}
            rightAxisWidth={STACKED_AXIS_WIDTH}
          />
        </ContentFrame>
      </div>
    </PanelSection>
  );
}
