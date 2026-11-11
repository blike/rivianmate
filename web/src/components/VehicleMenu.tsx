import type { ReactNode } from 'react';
import type { VehicleDto } from '@server/api-types';
import { Select } from './Select';

export const vehicleName = (v: VehicleDto) => v.name ?? v.model ?? v.vin;

/**
 * The vehicle picker: the app's dropdown, grouped by where the data comes
 * from when there's more than one source, with each vehicle's model beside
 * its name. The trigger's look is the caller's (`children`, given whether
 * the list is open); the list drops below it, as wide as it.
 */
export function VehicleMenu(props: {
  vehicles: VehicleDto[];
  value: string | undefined;
  onChange: (id: string) => void;
  /** Classes for the trigger button. */
  className: string;
  /** The list sized to the vehicles' names rather than the trigger. */
  fitList?: boolean;
  children: (open: boolean) => ReactNode;
}) {
  const rivian = props.vehicles.filter((v) => v.source !== 'teslamate');
  const tesla = props.vehicles.filter((v) => v.source === 'teslamate');
  const options = [...rivian, ...tesla].map((v) => {
    const model = [v.modelYear, v.model].filter(Boolean).join(' ');
    return {
      value: v.id,
      label: vehicleName(v),
      detail: model && model !== v.name ? model : undefined,
      // The car's make: TeslaMate is only where its data comes from.
      group: v.source === 'teslamate' ? 'Tesla' : 'Rivian',
    };
  });
  return (
    <Select
      label="Vehicle"
      value={props.value ?? ''}
      options={options}
      onChange={props.onChange}
      trigger={props.children}
      triggerClassName={props.className}
      fitList={props.fitList}
    />
  );
}
