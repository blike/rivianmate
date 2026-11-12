import { useMemo } from 'react';
import { ContentFrame } from '../../components/LoadingState';
import { TrendChart } from '../../components/TrendChart';
import { minuteTicks } from '../../lib/drives';
import { clock } from '../../lib/format';
import { fmt, fmtSeconds } from '../../lib/state';
import { chargingCurveWindow } from './chargingCurve';
import { smoothByTime, smoothingWindowMinutes } from './smoothing';

/**
 * Power and battery level through the session, with the vehicle's forecast
 * while it charges, or the app's estimate when the vehicle sends none.
 */
export function CurveChart(props: {
  curve: Parameters<typeof chargingCurveWindow>[0] | undefined;
  loading: boolean;
  /**
   * Plugged in but not charging yet: battery level while it waits isn't a
   * charging curve, so none is drawn until charging starts.
   */
  notStarted?: boolean;
  /** The charge limit it was charging toward, marked on the battery axis. */
  limit?: number | null;
}) {
  // Start elapsed time at the first recorded power reading, not plug-in.
  const curveWindow = useMemo(() => chargingCurveWindow(props.curve ?? []), [props.curve]);
  const data = useMemo(() => {
    const { points, originMs } = curveWindow;
    const minutes = points.map((p) => (Date.parse(p.ts) - (originMs ?? 0)) / 60_000);
    // Recorded points come first, then the forecast.
    const recordedCount = points.filter((p) => !p.projected).length;
    const window = smoothingWindowMinutes((minutes.at(-1) ?? 0) - (minutes[0] ?? 0));
    const recordedMinutes = minutes.slice(0, recordedCount);
    const recorded = points.slice(0, recordedCount);
    const soc = smoothByTime(
      recordedMinutes,
      recorded.map((p) => p.soc),
      window,
    );
    const forecast = smoothByTime(
      minutes.slice(recordedCount),
      points.slice(recordedCount).map((p) => p.soc),
      window,
    );
    const hasForecast = forecast.length > 0;
    return points.map((_, i) => {
      const isRecorded = i < recordedCount;
      return {
        minutes: minutes[i]!,
        power: isRecorded ? recorded[i]!.powerKw : null,
        soc: isRecorded ? soc[i]! : null,
        forecast: isRecorded
          ? hasForecast && i === recordedCount - 1
            ? soc[i]!
            : null
          : forecast[i - recordedCount]!,
      };
    });
  }, [curveWindow]);

  const hasForecast = curveWindow.points.some((p) => p.projected);
  const estimated = curveWindow.points.some((p) => p.projected && p.estimated);
  // Without power, the curve is battery level from recorded vehicle state.
  const hasPower = data.some((p) => p.power != null);
  const total = data.at(-1)?.minutes ?? 0;
  const ticks = minuteTicks(data[0]?.minutes ?? 0, total);
  const formatTime = (m: number) => (total >= 120 ? fmtSeconds(m * 60) : `${fmt(m, 0)} min`);
  const tooltipTime = (m: number) => {
    const elapsed = fmtSeconds(m * 60);
    if (curveWindow.originMs == null) return elapsed;
    return (
      <>
        <div className="font-medium">{clock(curveWindow.originMs + m * 60_000)}</div>
        <div className="text-(--text-muted)">{elapsed} in</div>
      </>
    );
  };
  const limitLine = (right: boolean) =>
    props.limit != null
      ? [
          {
            y: props.limit,
            label: `Limit ${fmt(props.limit, 0)}%`,
            color: 'var(--text-secondary)',
            right,
          },
        ]
      : undefined;
  const forecastSeries = hasForecast
    ? [
        {
          key: 'forecast',
          label: estimated ? 'Estimate' : 'Forecast',
          // Straight segments: a smoothed curve bows where the projection
          // joins the recorded curve at a different slope.
          interpolation: 'linear' as const,
          color: 'var(--accent)',
          mark: 'line' as const,
          dashed: true,
          unit: '%',
          digits: 0,
        },
      ]
    : [];

  return (
    <>
      <ContentFrame
        height={260}
        loading={props.loading}
        empty={props.notStarted || data.length <= 1}
        emptyText={
          props.notStarted
            ? 'Charging hasn’t started yet. The curve begins when it does.'
            : "No charging data for this session: Rivian didn't provide a power curve, and RivianMate wasn't recording while it charged."
        }
      >
        {hasPower ? (
          <TrendChart
            data={data}
            xKey="minutes"
            height={260}
            xTicks={ticks}
            xFormatter={formatTime}
            tooltipLabel={tooltipTime}
            leftDomain={[0, 'auto']}
            leftUnit="kW"
            rightUnit="%"
            rightDomain={[0, 100]}
            references={limitLine(true)}
            series={[
              {
                key: 'power',
                label: 'Power',
                interpolation: 'linear',
                connectNulls: false,
                color: 'var(--series-1)',
                unit: 'kW',
                digits: 1,
              },
              {
                key: 'soc',
                label: 'Battery',
                color: 'var(--accent)',
                mark: 'line',
                right: true,
                unit: '%',
                digits: 0,
              },
              ...forecastSeries.map((f) => ({ ...f, right: true })),
            ]}
          />
        ) : (
          <TrendChart
            data={data}
            xKey="minutes"
            height={260}
            xTicks={ticks}
            xFormatter={formatTime}
            tooltipLabel={tooltipTime}
            leftDomain={[0, 100]}
            leftUnit="%"
            references={limitLine(false)}
            series={[
              {
                key: 'soc',
                label: 'Battery',
                color: 'var(--accent)',
                mark: 'line',
                unit: '%',
                digits: 0,
                dots: true,
              },
              ...forecastSeries,
            ]}
          />
        )}
      </ContentFrame>
      {!props.loading && !props.notStarted && !hasPower && data.length > 1 && (
        <p className="mt-2 text-xs text-(--text-muted)">
          Rivian didn’t provide power for this session, so this is battery level only.
        </p>
      )}
    </>
  );
}
