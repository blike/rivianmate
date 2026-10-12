import { MAX_RADIUS_M, MIN_RADIUS_M } from '@server/services/locations';
import { useRef, useState } from 'react';
import { api, type GeocodeResultDto, type SavedLocationInput } from '../../api/client';
import { useUnits } from '../../api/hooks';
import { LocationPicker, type PickerArea } from '../../components/LocationPicker';
import { formatMoney } from '../../lib/charging';
import { Switch, secondaryButton } from './SettingsControls';

/** A typical overnight top-up, to put the rate in familiar terms. */
const EXAMPLE_KWH = 50;
const RADIUS_STEP_M = 5;
const MIN_QUERY = 3;

/** Empty is "no rate"; otherwise a price per kWh from 0 to 10. */
export function parseRate(text: string): { rate: number | null; invalid: boolean } {
  if (text.trim() === '') return { rate: null, invalid: false };
  const rate = Number(text);
  return { rate, invalid: !Number.isFinite(rate) || rate < 0 || rate > 10 };
}

/** Adds or edits a saved location: its name, rate, whether it's home, and its area. */
export function LocationEditor(props: {
  initial: SavedLocationInput;
  isNew: boolean;
  currency: string;
  others: readonly PickerArea[];
  vehicle: { lat: number; lon: number } | null;
  saving: boolean;
  error: boolean;
  onSave: (location: SavedLocationInput) => void;
  onCancel: () => void;
}) {
  const u = useUnits();
  const [name, setName] = useState(props.initial.name);
  const [isHome, setIsHome] = useState(props.initial.isHome);
  const [rateText, setRateText] = useState(
    props.initial.ratePerKwh != null ? String(props.initial.ratePerKwh) : '',
  );
  const [radiusM, setRadiusM] = useState(props.initial.radiusM);
  const [center, setCenter] = useState({ lat: props.initial.lat, lon: props.initial.lon });

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResultDto[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // The dropdown shows while the field has focus, and closes when it's left.
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const term = query.trim();

  // On Enter or the button only: Nominatim's usage policy rules out
  // searching as you type. Results lean toward where the map is now.
  const search = async () => {
    if (term.length < MIN_QUERY || searching) return;
    setSearching(true);
    setSearchError(null);
    setOpen(true);
    // The button takes focus; give it back so leaving the field closes the list.
    field.current?.focus();
    // A field changed or emptied while searching keeps what it shows now.
    const stillAsked = () => field.current?.value.trim() === term;
    try {
      const found = await api.searchPlaces(term, center);
      if (stillAsked()) setResults(found);
    } catch (err) {
      if (stillAsked()) {
        setResults(null);
        setSearchError((err as Error).message);
      }
    } finally {
      setSearching(false);
    }
  };

  const pick = (r: GeocodeResultDto) => {
    setCenter({ lat: r.lat, lon: r.lon });
    setQuery('');
    setResults(null);
    setOpen(false);
  };

  const { rate, invalid: rateInvalid } = parseRate(rateText);
  const nameInvalid = name.trim() === '';

  return (
    <form
      className="card space-y-4 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (nameInvalid || rateInvalid) return;
        props.onSave({ name: name.trim(), isHome, ratePerKwh: rate, radiusM, ...center });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Name
          <input
            value={name}
            maxLength={40}
            placeholder="Work"
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded-md border border-(--border) bg-(--surface-2) px-2.5 py-1.5 text-sm font-normal outline-none focus:border-(--text-muted)"
          />
        </label>
        <label className="block text-sm font-medium">
          Charging rate
          <span className="mt-1 flex items-center rounded-md border border-(--border) bg-(--surface-2) focus-within:border-(--text-muted)">
            <input
              inputMode="decimal"
              placeholder="None"
              value={rateText}
              onChange={(e) => setRateText(e.target.value)}
              aria-invalid={rateInvalid}
              className="w-full min-w-0 bg-transparent py-1.5 pl-2.5 text-sm font-normal tabular-nums outline-none"
            />
            <span className="whitespace-nowrap pl-1 pr-2.5 text-sm font-normal text-(--text-muted)">
              {props.currency} / kWh
            </span>
          </span>
          <span className="mt-1 block text-xs font-normal text-(--text-muted)">
            {rateInvalid ? (
              <span className="text-(--status-critical)">Enter a rate between 0 and 10.</span>
            ) : rate === 0 ? (
              'Free: sessions here cost nothing.'
            ) : rate != null ? (
              `A ${EXAMPLE_KWH} kWh charge costs about ${formatMoney(String(rate * EXAMPLE_KWH), props.currency)}.`
            ) : (
              'Leave empty to not estimate costs here.'
            )}
          </span>
        </label>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Counts as home</div>
          <div className="text-xs text-(--text-muted)">
            Holds “only when not at home” alerts here, and marks it with the home icon.
          </div>
        </div>
        <Switch label="Counts as home" checked={isHome} onChange={setIsHome} />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              ref={field}
              type="search"
              value={query}
              placeholder="Search for a place or address"
              aria-label="Search for a place or address"
              aria-expanded={open}
              aria-controls="place-results"
              onChange={(e) => {
                setQuery(e.target.value);
                // An emptied field (typed away or its ✕) drops the last results.
                if (e.target.value.trim() === '') {
                  setResults(null);
                  setSearchError(null);
                }
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              onKeyDown={(e) => {
                // Enter searches rather than submitting the form.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void search();
                } else if (e.key === 'Escape' && open) {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
              className="w-full rounded-md border border-(--border) bg-(--surface-2) px-2.5 py-1.5 text-sm outline-none focus:border-(--text-muted)"
            />
            {open && (searching || searchError || results) && (
              <div
                id="place-results"
                className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-(--border) bg-(--surface-1) shadow-lg"
              >
                {searching ? (
                  <p className="px-3 py-2 text-sm text-(--text-muted)">Searching…</p>
                ) : searchError ? (
                  <p className="px-3 py-2 text-sm text-(--status-critical)">{searchError}</p>
                ) : results?.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-(--text-muted)">Nothing found.</p>
                ) : (
                  <ul className="divide-y divide-(--border)">
                    {results?.map((r) => (
                      <li key={`${r.lat},${r.lon}`}>
                        <button
                          type="button"
                          // Keeps focus in the field, so picking doesn't close the list first.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pick(r)}
                          className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-(--surface-2)"
                        >
                          {r.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            className={secondaryButton}
            disabled={searching || term.length < MIN_QUERY}
            // Keeps focus in the field while searching.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void search()}
          >
            Search
          </button>
          <button
            type="button"
            className={secondaryButton}
            disabled={!props.vehicle}
            title={props.vehicle ? undefined : "The vehicle's location isn't known yet"}
            onClick={() => props.vehicle && setCenter(props.vehicle)}
          >
            Use vehicle’s location
          </button>
        </div>
        <LocationPicker
          area={{ ...center, radiusM }}
          others={props.others}
          onMove={(lat, lon) => setCenter({ lat, lon })}
        />
        <p className="text-xs text-(--text-muted)">
          Move the map to put the pin where you park. Drives and charging inside the circle are
          named {name.trim() ? `“${name.trim()}”` : 'after this location'}.
        </p>
      </div>

      <label className="block text-sm font-medium">
        <span className="flex justify-between">
          Area
          <span className="font-normal tabular-nums text-(--text-secondary)">
            {u.formatElevation(radiusM)} around the pin
          </span>
        </span>
        <input
          type="range"
          min={MIN_RADIUS_M}
          max={MAX_RADIUS_M}
          step={RADIUS_STEP_M}
          value={radiusM}
          onChange={(e) => setRadiusM(Number(e.target.value))}
          className="mt-2 block w-full accent-(--accent)"
        />
      </label>

      {props.error && (
        <p role="alert" className="text-xs text-(--status-critical)">
          Couldn’t save. Try again.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryButton} onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn-primary"
          disabled={nameInvalid || rateInvalid || props.saving}
        >
          {props.isNew ? 'Add location' : 'Save'}
        </button>
      </div>
    </form>
  );
}
