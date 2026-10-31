import { useState } from 'react';
import {
  useChargingSettings,
  useLookupSettings,
  useSetChargingSettings,
  useSetLookupSettings,
  useSetUnits,
  useUnits,
  useVehicles,
} from '../../api/hooks';
import { Skeleton } from '../../components/LoadingState';
import {
  SegmentedControl,
  Select,
  SettingRow,
  SettingsGroup,
  Switch,
  secondaryButton,
} from './SettingsControls';
import { AccountsPanel } from './AccountsPanel';
import { LOOKUPS } from './LookupDetails';

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD'];

export function GeneralSection(props: {
  parallaxModes: Record<string, 'classic' | 'parallax'> | undefined;
}) {
  const { data: vehicles, isPending } = useVehicles();
  const u = useUnits();
  const { units } = u;
  const setUnits = useSetUnits();
  const { data: charging } = useChargingSettings();
  const setCharging = useSetChargingSettings();
  const { data: lookups } = useLookupSettings();
  const setLookups = useSetLookupSettings();

  return (
    <>
      <SettingsGroup title={vehicles && vehicles.length > 1 ? 'Vehicles' : 'Vehicle'}>
        {isPending ? (
          <SettingRow
            label={<Skeleton className="w-[8em]" />}
            description={<Skeleton className="w-[5em]" />}
          />
        ) : !vehicles?.length ? (
          <SettingRow label="No vehicles yet" description="Vehicles appear here once connected." />
        ) : (
          vehicles.map((v) => {
            const mode = props.parallaxModes?.[v.id];
            return (
              <SettingRow
                key={v.id}
                label={v.name ?? v.model ?? 'Vehicle'}
                description={[
                  v.modelYear,
                  v.model,
                  v.source === 'teslamate' && 'From TeslaMate',
                  mode && (mode === 'parallax' ? 'Parallax data' : 'Classic data'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              >
                <span className="select-all text-xs tracking-wide text-(--text-secondary)">
                  {v.vin}
                </span>
                <CopyButton text={v.vin} label="Copy VIN" />
              </SettingRow>
            );
          })
        )}
      </SettingsGroup>

      <SettingsGroup title="Units">
        <SettingRow
          label="Measurement"
          description={`Distance, speed, tire pressure and elevation: ${u.distanceUnit}, ${u.speedUnit}, ${u.pressureUnit}, ${u.elevationUnit}`}
        >
          <SegmentedControl
            label="Measurement"
            value={units.distance}
            options={[
              { value: 'mi', label: 'Imperial' },
              { value: 'km', label: 'Metric' },
            ]}
            onChange={(distance) => setUnits.mutate({ ...units, distance })}
          />
        </SettingRow>
        <SettingRow
          label="Temperature"
          description={`Cabin ${u.formatTemperature(21)} · Outside ${u.formatTemperature(4)}`}
        >
          <SegmentedControl
            label="Temperature"
            value={units.temperature}
            options={[
              { value: 'F', label: '°F' },
              { value: 'C', label: '°C' },
            ]}
            onChange={(temperature) => setUnits.mutate({ ...units, temperature })}
          />
        </SettingRow>
        <SettingRow label="Currency" htmlFor="currency" description="For charging rates and costs.">
          <Select
            id="currency"
            label="Currency"
            value={charging?.currency ?? 'USD'}
            options={CURRENCIES}
            disabled={!charging || setCharging.isPending}
            onChange={(currency) => setCharging.mutate({ currency })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Outside services"
        note="When turned back on, a lookup also fills in the drives made while it was off."
      >
        {(['addresses', 'weather'] as const).map((key) => (
          <SettingRow key={key} label={LOOKUPS[key].label} description={LOOKUPS[key].summary}>
            {lookups && (
              <Switch
                label={`${LOOKUPS[key].label} lookups`}
                checked={lookups[key]}
                onChange={(on) => setLookups.mutate({ ...lookups, [key]: on })}
              />
            )}
          </SettingRow>
        ))}
      </SettingsGroup>

      <AccountsPanel />
    </>
  );
}

function CopyButton(props: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={secondaryButton}
      aria-label={props.label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(props.text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard unavailable (e.g. plain http); the VIN is still selectable.
        }
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
