import { useMemo } from 'react';
import { type PackTempSpan, usePackTemps, useUnits } from '../api/hooks';
import { formatMinutes, minuteTicks, tooltipTime } from '../lib/drives';
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
 * change, and a chart of the average with the coldest-to-hottest band. Left
 * out when the span has no reading.
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
  // The history also carries the last reading before the span, however old,
  // so having points doesn't mean the span has a reading.
  const shown =
    figures.startC != null ||
    figures.endC != null ||
    readings.some((r) => r.avgC != null && r.at >= startMs && (endedAt == null || r.at <= endedAt));
  if (!shown) return null;
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
          emptyText={`One pack temperature reading was recorded on this ${spanName}, and one is no trend to draw.`}
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
