import { useState } from 'react';
import {
  useChargingSettings,
  useRivianDisconnect,
  useSetChargingSettings,
  useSetUnits,
  useStatus,
  useUnits,
  useVehicles,
} from '../../api/hooks';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Dot } from '../../components/Dot';
import { Skeleton } from '../../components/LoadingState';
import {
  SegmentedControl,
  SettingRow,
  SettingsGroup,
  dangerButton,
  secondaryButton,
} from './SettingsControls';

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD'];

export function GeneralSection(props: {
  parallaxModes: Record<string, 'classic' | 'parallax'> | undefined;
  email: string | null;
  connected: boolean;
  mockMode: boolean;
}) {
  const { data: vehicles, isPending } = useVehicles();
  const { refetch } = useStatus();
  const disconnect = useRivianDisconnect();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const u = useUnits();
  const { units } = u;
  const setUnits = useSetUnits();
  const { data: charging } = useChargingSettings();
  const setCharging = useSetChargingSettings();

  return (
    <>
      <SettingsGroup title={vehicles && vehicles.length > 1 ? 'Vehicles' : 'Vehicle'}>
        {isPending ? (
          <SettingRow
            label={<Skeleton className="w-[8em]" />}
            description={<Skeleton className="w-[5em]" />}
          />
        ) : !vehicles?.length ? (
          <SettingRow
            label="No vehicles yet"
            description="Vehicles on your Rivian account appear here once connected."
          />
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
                  mode && (mode === 'parallax' ? 'Parallax data' : 'Classic data'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              >
                <span className="select-all font-mono text-xs tracking-wide text-(--text-secondary)">
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
          <select
            id="currency"
            value={charging?.currency ?? 'USD'}
            disabled={!charging || setCharging.isPending}
            onChange={(e) => setCharging.mutate({ currency: e.target.value })}
            className="rounded-md border border-(--border) bg-(--surface-2) px-2 py-1.5 text-sm outline-none"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Rivian account">
        <SettingRow
          label={props.email ?? '—'}
          description={
            <span className="inline-flex items-center gap-1.5">
              <Dot color={props.connected ? 'var(--status-good)' : 'var(--text-muted)'} />
              {props.connected ? 'Connected' : 'Disconnected'}
              {props.mockMode && ' · Simulated vehicle'}
            </span>
          }
        />
        <SettingRow
          label="Disconnect"
          description="Stops tracking and forgets your Rivian sign-in. Your recorded history stays."
        >
          <button className={dangerButton} onClick={() => setConfirmingDisconnect(true)}>
            Disconnect
          </button>
        </SettingRow>
      </SettingsGroup>

      <ConfirmDialog
        open={confirmingDisconnect}
        title="Disconnect your Rivian account?"
        confirmLabel="Disconnect"
        busy={disconnect.isPending}
        onCancel={() => setConfirmingDisconnect(false)}
        onConfirm={() =>
          disconnect.mutate(undefined, {
            onSettled: () => {
              setConfirmingDisconnect(false);
              refetch();
            },
          })
        }
      >
        RivianMate stops tracking and forgets your Rivian sign-in. Your recorded history stays.
      </ConfirmDialog>
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
