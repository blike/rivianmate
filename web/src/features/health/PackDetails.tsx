import type { VehicleInsightsDto } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { Row } from '../../components/Panel';
import { showParallaxOnly } from '../../lib/fieldSources';
import { dateTime } from '../../lib/format';
import { fmt } from '../../lib/state';
import type { PowerOutputVerdict } from '../../lib/vehicleStatus';

/** The pack's cells, their temperatures, and the range the cold holds back. */
export function PackDetails(props: {
  insights: VehicleInsightsDto | undefined;
  /** Left out when undefined: legacy doesn't report it for this vehicle. */
  cellType?: string | null;
  /** Left out when undefined: a vehicle that never sends one shows no verdict. */
  powerOutput?: PowerOutputVerdict | null;
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
              // The verdict belongs on the value's line, and wraps below it when
              // the phone is narrow or the type is large.
              <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                <span>
                  {cellTemps
                    ? `${u.formatTemperature(cellTemps.avgC)} (${fmt(u.temperature(cellTemps.minC), 0)}–${fmt(u.temperature(cellTemps.maxC), 0)})`
                    : '—'}
                </span>
                {props.powerOutput && <PowerOutputChip powerOutput={props.powerOutput} />}
              </span>
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

/**
 * The pack's own verdict beside its temperature. A cold-limited pack is a
 * temperature, not a fault, so it reads in ice blue rather than a warning.
 */
function PowerOutputChip(props: { powerOutput: PowerOutputVerdict }) {
  const normal = props.powerOutput === 'normal';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 text-[10.5px] leading-[14px] font-medium ${
        normal
          ? 'border-[color-mix(in_srgb,var(--status-good)_45%,transparent)] bg-[color-mix(in_srgb,var(--status-good)_14%,transparent)] text-(--status-good)'
          : 'border-[color-mix(in_srgb,var(--status-cold)_45%,transparent)] bg-[color-mix(in_srgb,var(--status-cold)_14%,transparent)] text-(--status-cold)'
      }`}
    >
      <span className="sr-only">Power output </span>
      {normal ? 'normal' : 'cold-limited'}
    </span>
  );
}
