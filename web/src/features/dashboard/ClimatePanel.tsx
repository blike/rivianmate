import type { VehicleState } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { Row } from '../../components/Panel';
import { nv, sv, titleCase } from '../../lib/state';
import { preconditioningLabel } from '../../lib/vehicleStatus';

export function ClimatePanel(props: { state: VehicleState | undefined }) {
  const s = props.state;
  const u = useUnits();
  const interior = nv(s, 'cabinClimateInteriorTemperature');
  return (
    <dl className="space-y-1 text-sm">
      <Row label="Cabin temperature" value={u.formatTemperature(interior)} />
      <Row
        label="Set temperature"
        value={u.formatTemperature(nv(s, 'cabinClimateDriverTemperature'))}
      />
      <Row label="Preconditioning" value={preconditioningLabel(s)} />
      <Row label="Defrost" value={titleCase(sv(s, 'defrostDefogStatus'))} />
      <Row label="Pet mode" value={titleCase(sv(s, 'petModeStatus'))} />
    </dl>
  );
}
