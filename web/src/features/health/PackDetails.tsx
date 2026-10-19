import type { VehicleInsightsDto } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { Row } from '../../components/Panel';
import { showParallaxOnly } from '../../lib/fieldSources';
import { dateTime } from '../../lib/format';
import { fmt } from '../../lib/state';

/** The pack's cells, their temperatures, and the range the cold holds back. */
export function PackDetails(props: {
  insights: VehicleInsightsDto | undefined;
  /** Left out when undefined: legacy doesn't report it for this vehicle. */
  cellType?: string | null;
}) {
  const u = useUnits();
  const { cellTemps, cellTempsCurrent, coldWeather } = props.insights ?? {};
  const cold = coldWeather && coldWeather.rangeImpactKm > 0 ? coldWeather : null;
  const showTemps = showParallaxOnly(props.insights, 'cellTemps');

  return (
    <div>
      <dl className="divide-y divide-(--hairline) text-sm [&>div]:py-2.5 [&>div:first-child]:pt-0">
        {props.cellType !== undefined && (
          <Row label="Battery cells" value={props.cellType ?? '—'} />
        )}
        {showTemps && (
          <Row
            label="Cell temperature"
            value={
              cellTemps
                ? `${u.formatTemperature(cellTemps.avgC)} (${fmt(u.temperature(cellTemps.minC), 0)}–${fmt(u.temperature(cellTemps.maxC), 0)})`
                : '—'
            }
          />
        )}
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
      {showTemps && (
        <p className="mt-2 text-xs leading-relaxed text-(--text-muted)">
          {cellTemps && !cellTempsCurrent
            ? `Cell temperatures as of ${dateTime(cellTemps.at)}; the vehicle reports them only while awake.`
            : 'Cell temperatures are reported only while the vehicle is awake.'}
        </p>
      )}
    </div>
  );
}
