import { useState } from 'react';
import { ApiError, type LookupSettings } from '../../api/client';
import { useSetLookupSettings, useUnits } from '../../api/hooks';
import { AuthCard } from '../../components/AuthCard';
import { PlaceIcon } from '../../components/PlaceIcon';
import { WeatherIcon } from '../../components/WeatherIcon';
import { compass, weatherKind, weatherLabel } from '../../lib/weather';
import { LOOKUPS, LookupDetails } from '../settings/LookupDetails';
import { Switch } from '../settings/SettingsControls';

/**
 * The last step of first-run setup: which outside lookups to allow. Both
 * stay off until this is answered, so a lookup turned off here never runs.
 */
export function OutsideServicesPage(props: { onDone: () => void }) {
  const [lookups, setLookups] = useState<LookupSettings>({ addresses: true, weather: true });
  const save = useSetLookupSettings();
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync(lookups);
      props.onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Saving failed');
    }
  };

  return (
    <AuthCard
      title="Outside services"
      subtitle="RivianMate can enhance your drives with street addresses and weather from free outside services. You can change this later in Settings."
      step={{ current: 4, total: 4 }}
      error={error}
      busy={save.isPending}
      submitLabel="Start using RivianMate"
      onSubmit={submit}
    >
      <DrivePreview lookups={lookups} />
      <div className="divide-y divide-(--border) rounded-lg border border-(--border)">
        {(['addresses', 'weather'] as const).map((key) => (
          <div key={key} className="space-y-2 px-3.5 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm font-medium">
                {LOOKUPS[key].label}{' '}
                <span className="font-normal text-(--text-muted)">· {LOOKUPS[key].service}</span>
              </div>
              <Switch
                label={`${LOOKUPS[key].label} lookups`}
                checked={lookups[key]}
                onChange={(on) => setLookups({ ...lookups, [key]: on })}
              />
            </div>
            <LookupDetails lookup={key} on={lookups[key]} />
          </div>
        ))}
      </div>
    </AuthCard>
  );
}

/** A made-up drive, as a drive row shows it: where to and its weather. */
const SAMPLE = {
  /** Shortened, as the Drives list shows an address. */
  to: '306 W Willow St',
  /** As unnamed places show with address lookups off. */
  coordinates: '40.4842°N 88.9937°W',
  km: 37,
  minutes: 38,
  tempC: 12,
  weatherCode: 61,
  windKmh: 19,
  windFromDeg: 270,
};

/**
 * A sample drive that follows the switches, so each choice shows what it
 * changes: the route on its own line, so the address is never cut short,
 * then the drive and its weather. Both versions of each part share a grid
 * cell, the hidden one invisible, so nothing moves when a switch flips.
 */
function DrivePreview(props: { lookups: LookupSettings }) {
  const u = useUnits();
  const layer = (shown: boolean) => `col-start-1 row-start-1 ${shown ? '' : 'invisible'}`;
  const condition = weatherLabel(SAMPLE.weatherCode);
  return (
    <figure className="rounded-lg bg-(--surface-2) px-3.5 py-3">
      <figcaption className="mb-2 text-[11px] font-medium uppercase tracking-wide text-(--text-muted)">
        Preview
      </figcaption>
      <div className="flex min-w-0 items-baseline text-sm">
        <span className="shrink-0 font-medium">
          <PlaceIcon isHome saved={false} />
          Home
        </span>
        <span className="shrink-0 text-(--text-muted)">&nbsp;→&nbsp;</span>
        <span className="grid min-w-0">
          <span className={`truncate ${layer(props.lookups.addresses)}`}>{SAMPLE.to}</span>
          <span className={`truncate tabular-nums ${layer(!props.lookups.addresses)}`}>
            {SAMPLE.coordinates}
          </span>
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs tabular-nums text-(--text-muted)">
        <span className="shrink-0">
          {u.formatDistance(SAMPLE.km)} · {SAMPLE.minutes}m
        </span>
        <span className="grid min-w-0 justify-items-end">
          <span className={`flex min-w-0 items-center gap-1.5 ${layer(props.lookups.weather)}`}>
            <WeatherIcon
              kind={weatherKind(SAMPLE.weatherCode)}
              label={condition}
              className="size-4 shrink-0 text-(--text-secondary)"
            />
            <span className="truncate">
              <span className="font-medium text-(--text-secondary)">
                {u.formatTemperature(SAMPLE.tempC)}
              </span>{' '}
              · {condition} · {u.formatSpeed(SAMPLE.windKmh)} {compass(SAMPLE.windFromDeg)}
            </span>
          </span>
          <span className={layer(!props.lookups.weather)}>No weather</span>
        </span>
      </div>
    </figure>
  );
}
