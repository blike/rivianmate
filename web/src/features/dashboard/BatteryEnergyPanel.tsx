import type { VehicleInsightsDto } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { Row } from '../../components/Panel';
import { dateTime } from '../../lib/format';
import { fmt } from '../../lib/state';

/** Battery temperatures and cold-weather impact. */
export function BatteryEnergyPanel(props: {
  insights: VehicleInsightsDto | undefined;
  cellType?: string | null;
}) {
  const u = useUnits();
  const { cellTemps, cellTempsCurrent, coldWeather } = props.insights ?? {};
  const cold = coldWeather && coldWeather.rangeImpactKm > 0 ? coldWeather : null;

  return (
    <>
      <dl className="space-y-1 text-sm">
        <Row label="Battery cells" value={props.cellType ?? '—'} />
        <Row
          label="Cell temperature"
          value={
            cellTemps
              ? `${u.formatTemperature(cellTemps.avgC)} (${fmt(u.temperature(cellTemps.minC), 0)}–${fmt(u.temperature(cellTemps.maxC), 0)})`
              : '—'
          }
        />
        <Row
          label="Cold-weather impact"
          value={
            !coldWeather
              ? '—'
              : cold
                ? `−${u.formatDistance(cold.rangeImpactKm)} (${fmt(cold.coldSoc, 0)}% held back)`
                : 'None'
          }
        />
      </dl>
      <p className="mt-2 text-xs text-(--text-muted)">
        {cellTemps && !cellTempsCurrent
          ? `Cell temperatures as of ${dateTime(cellTemps.at)}; the vehicle reports them only while awake.`
          : 'Cell temperatures are reported only while the vehicle is awake.'}
      </p>
    </>
  );
}
