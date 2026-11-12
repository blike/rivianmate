import { useMemo } from 'react';
import type { HistoryPoint } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { ContentFrame } from '../../components/LoadingState';
import { TrendChart, type TrendSeries } from '../../components/TrendChart';
import { minuteTicks } from '../../lib/drives';
import { clock } from '../../lib/format';
import { packReadings, packTemperatures } from '../../lib/packTemperature';
import { fmt, fmtSeconds } from '../../lib/state';
import { chargingCurveWindow } from './chargingCurve';
import { smoothByTime, smoothingWindowMinutes } from './smoothing';

/**
 * Power and battery level through the session, with the vehicle's forecast
 * while it charges, or the app's estimate when the vehicle sends none — and
 * the pack's own temperature over it, which is why a charge runs slow.
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
  /** The pack's cell temperatures through the session, as recorded while it charged. */
  temperatures?: HistoryPoint[];
}) {
  const u = useUnits();
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
    // The pack's temperature at each of the curve's own points, so nothing is
    // drawn where it wasn't read: one series, as the drive page reads it.
    const pack = packTemperatures(
      packReadings(props.temperatures ?? []),
      points.map((p) => Date.parse(p.ts)),
      u.temperature,
    );
    return points.map((_, i) => {
      const isRecorded = i < recordedCount;
      const temperature = pack[i]!;
      // A band needs both ends: with only one recorded, the line still shows.
      const band: [number, number] | null =
        temperature.min != null && temperature.max != null
          ? [temperature.min, temperature.max]
          : null;
      return {
        minutes: minutes[i]!,
        power: isRecorded ? recorded[i]!.powerKw : null,
        soc: isRecorded ? soc[i]! : null,
        forecast: isRecorded
          ? hasForecast && i === recordedCount - 1
            ? soc[i]!
            : null
          : forecast[i - recordedCount]!,
        packAverage: temperature.avg,
        packRange: band,
      };
    });
  }, [curveWindow, props.temperatures, u]);

  const hasTemperature = data.some((row) => row.packAverage != null);
  // The pack rides its own hidden scale: with power in kW on the left and level
  // in % on the right, a third axis would be drawn over one of them. Its values
  // are in the tooltip, in the owner's unit.
  const temperatureSeries: TrendSeries[] = hasTemperature
    ? [
        {
          key: 'packRange',
          label: 'Pack range',
          color: 'var(--series-3)',
          band: true,
          // A band of readings, so straight segments, and none across a
          // silence in the recording.
          interpolation: 'linear',
          // Behind the power curve: context, not a second subject.
          zIndex: 50,
          ownScale: 'pack',
          unit: u.temperatureUnit,
          digits: 0,
        },
        {
          key: 'packAverage',
          label: 'Pack average',
          color: 'var(--series-3)',
          mark: 'line',
          interpolation: 'linear',
          connectNulls: false,
          ownScale: 'pack',
          unit: u.temperatureUnit,
          digits: 0,
        },
      ]
    : [];

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
              ...temperatureSeries,
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
              ...temperatureSeries,
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
