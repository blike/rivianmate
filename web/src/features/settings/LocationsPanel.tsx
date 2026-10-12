import { DEFAULT_RADIUS_M } from '@server/services/locations';
import { useState } from 'react';
import type { SavedLocation, SavedLocationInput } from '../../api/client';
import {
  useChargingSettings,
  useLocations,
  useSaveLocation,
  useUnits,
  useVehicleState,
} from '../../api/hooks';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Skeleton } from '../../components/LoadingState';
import { PlaceIcon } from '../../components/PlaceIcon';
import { rateLabel } from '../../lib/charging';
import { haversineKm } from '../../lib/geo';
import { location as vehicleLocation } from '../../lib/state';
import { LocationEditor } from './LocationEditor';
import { SettingRow, SettingsGroup, dangerButton, secondaryButton } from './SettingsControls';

/** A new location starts where the vehicle is, or else at home. */
function draft(
  vehicle: { lat: number; lon: number } | null,
  locations: readonly SavedLocation[],
): SavedLocationInput {
  const first = locations.length === 0;
  const at = vehicle ?? locations.find((l) => l.isHome) ?? locations[0] ?? { lat: 0, lon: 0 };
  return {
    name: first ? 'Home' : '',
    lat: at.lat,
    lon: at.lon,
    radiusM: DEFAULT_RADIUS_M,
    isHome: first,
    ratePerKwh: null,
  };
}

/** Places the vehicle parks, each with an optional charging rate. */
export function LocationsPanel(props: { vehicleId: string | undefined }) {
  const { data: settings } = useChargingSettings();
  const { data: locations = [], isPending } = useLocations();
  const save = useSaveLocation();
  const { data: state } = useVehicleState(props.vehicleId);
  const u = useUnits();
  const vehicle = vehicleLocation(state);
  const currency = settings?.currency ?? 'USD';
  // null: listing; 'new': adding; a number: editing that location.
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SavedLocation | null>(null);

  if (editing != null) {
    const current = editing === 'new' ? null : locations.find((l) => l.id === editing);
    return (
      <LocationEditor
        key={editing}
        isNew={current == null}
        initial={current ?? draft(vehicle, locations)}
        currency={currency}
        others={locations.filter((l) => l.id !== editing)}
        vehicle={vehicle}
        saving={save.isPending}
        error={save.isError}
        onCancel={() => {
          save.reset();
          setEditing(null);
        }}
        onSave={(input) =>
          save.mutate(
            { kind: 'save', id: current?.id ?? null, location: input },
            { onSuccess: () => setEditing(null) },
          )
        }
      />
    );
  }

  return (
    <>
      <SettingsGroup
        title="Places"
        action={
          <button className={secondaryButton} onClick={() => setEditing('new')}>
            Add location
          </button>
        }
        // Held back while loading, so it doesn't sit under an empty card and then jump.
        note={
          !isPending &&
          'Drives and charging at a location take its name, and sessions are priced at its rate unless they have a cost of their own. Sessions at your Rivian Wall Charger always count as home.'
        }
      >
        {isPending ? (
          <SettingRow
            label={<Skeleton className="w-[6em]" />}
            description={<Skeleton className="w-[12em]" />}
          />
        ) : locations.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-(--text-muted)">
            No locations yet. Add Home, Work, or anywhere you park and charge.
          </div>
        ) : (
          locations.map((l) => {
            const awayKm = vehicle ? haversineKm(l.lat, l.lon, vehicle.lat, vehicle.lon) : null;
            return (
              <SettingRow
                key={l.id}
                label={
                  <>
                    <PlaceIcon isHome={l.isHome} saved />
                    {l.name}
                  </>
                }
                description={[
                  rateLabel(l.ratePerKwh, currency),
                  awayKm != null &&
                    (awayKm * 1000 <= l.radiusM
                      ? 'Vehicle is here'
                      : `Vehicle is ${u.formatDistance(awayKm, awayKm < 10 ? 1 : 0)} away`),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              >
                <button className={secondaryButton} onClick={() => setEditing(l.id)}>
                  Edit
                </button>
                <button
                  className={dangerButton}
                  disabled={save.isPending}
                  onClick={() => setDeleting(l)}
                >
                  Delete
                </button>
              </SettingRow>
            );
          })
        )}
      </SettingsGroup>

      <ConfirmDialog
        open={deleting != null}
        title={`Delete ${deleting?.name ?? 'location'}?`}
        confirmLabel="Delete"
        busy={save.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          save.mutate({ kind: 'delete', id: deleting.id }, { onSettled: () => setDeleting(null) })
        }
      >
        Its drives and charging sessions go back to showing their addresses, and sessions there are
        no longer priced at its rate.
      </ConfirmDialog>

      {save.isError && (
        <p role="alert" className="text-xs text-(--status-critical)">
          {save.variables?.kind === 'delete' ? 'Couldn’t delete.' : 'Couldn’t save.'} Try again.
        </p>
      )}
    </>
  );
}
