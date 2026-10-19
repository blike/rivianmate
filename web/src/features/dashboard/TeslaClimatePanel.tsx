import type { VehicleState } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { Row } from '../../components/Panel';
import { nv, sv, titleCase } from '../../lib/state';

/** TeslaMate's climate readings: temperatures inside and out, and whether it's on. */
export function TeslaClimatePanel(props: { state: VehicleState | undefined }) {
  const s = props.state;
  const u = useUnits();
  const on = sv(s, 'climateOn');
  return (
    <dl className="space-y-1 text-sm">
      <Row
        label="Cabin temperature"
        value={u.formatTemperature(nv(s, 'cabinClimateInteriorTemperature'))}
      />
      <Row label="Outside temperature" value={u.formatTemperature(nv(s, 'outsideTemperature'))} />
      <Row
        label="Set temperature"
        value={u.formatTemperature(nv(s, 'cabinClimateDriverTemperature'))}
      />
      <Row label="Climate" value={on == null ? '—' : on === 'true' ? 'On' : 'Off'} />
      <Row label="Defrost" value={titleCase(sv(s, 'defrostDefogStatus'))} />
    </dl>
  );
}
