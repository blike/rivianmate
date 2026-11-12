import { useMemo } from 'react';
import type { DriveDetailDto } from '@server/api-types';
import { usePackTemps, useUnits } from '../../api/hooks';
import { ContentFrame, Skeleton } from '../../components/LoadingState';
import { PanelSection } from '../../components/Panel';
import { TrendChart } from '../../components/TrendChart';
import { minuteTicks } from '../../lib/drives';
import { clock } from '../../lib/format';
import { packReadings } from '../../lib/packTemperature';
import { fmtSeconds } from '../../lib/state';
import { formatMinutes, tooltipTime } from './format';
import {
  packTempChangeText,
  packTempDigits,
  packTempFigures,
  packTempSeries,
  packTempText,
} from './packTemp';

/**
 * The pack's temperature along a drive: what it read at each end and how far it
 * moved, over the average with the coldest and hottest cell shaded around it.
 * A drive moves the pack only a degree or three, so the figures carry what a
 * curve this flat can't. The vehicle reports temperatures only while it's
 * awake, and only once they move past a deadband, so the line breaks where
 * nothing was recorded rather than drawing across it.
 */
export function PackTempSection(props: {
  vehicleId: string;
  drive: DriveDetailDto | undefined;
  loading: boolean;
}) {
  const u = useUnits();
  const drive = props.drive;
  const { data: history, isPending } = usePackTemps(
    props.vehicleId,
    drive && { id: drive.id, from: drive.startedAt, to: drive.endedAt },
  );
  const readings = useMemo(() => packReadings(history ?? []), [history]);
  const startMs = drive ? Date.parse(drive.startedAt) : 0;
  // A drive under way has no end yet, so its line runs to its latest reading.
  const live = drive != null && drive.endedAt == null;
  const endedAt = drive?.endedAt ? Date.parse(drive.endedAt) : null;
  const endMs = endedAt ?? (drive ? (readings.at(-1)?.at ?? startMs) : 0);

  const figures = useMemo(
    () => packTempFigures(readings, { startMs, endMs, live }),
    [readings, startMs, endMs, live],
  );
  const rows = useMemo(
    () => packTempSeries(readings, { startMs, endMs, toDisplay: u.temperature }),
    [readings, startMs, endMs, u],
  );
  const loading = props.loading || isPending;
  const digits = packTempDigits(u);
  const total = (endMs - startMs) / 60_000;
  // A change needs two readings, at two ends of the drive.
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
              ? 'No pack temperature was recorded on this drive: the vehicle reports it only while it’s awake.'
              : 'One pack temperature reading was recorded on this drive, and one is no trend to draw.'
          }
        >
          <TrendChart
            data={rows}
            xKey="minutes"
            height={150}
            xTicks={minuteTicks(0, total)}
            xFormatter={formatMinutes(total)}
            tooltipLabel={drive ? tooltipTime(drive.startedAt) : undefined}
            leftUnit={u.temperatureUnit}
            series={[
              {
                key: 'band',
                label: 'Coldest to hottest cell',
                color: 'var(--series-4)',
                band: true,
                // Straight between readings, and broken wherever none was
                // recent enough to draw.
                interpolation: 'linear',
                unit: u.temperatureUnit,
                digits,
              },
              {
                key: 'avg',
                label: 'Pack temperature',
                color: 'var(--series-4)',
                mark: 'line',
                // Straight between readings, and never across a stretch nothing
                // was recorded in: the line stops and picks up where data resumes.
                interpolation: 'linear',
                connectNulls: false,
                unit: u.temperatureUnit,
                digits,
              },
            ]}
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
