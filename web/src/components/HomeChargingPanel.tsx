import { useState } from "react";
import { useHomeCharging, useSetHomeCharging, useVehicleState } from "../api/hooks.js";
import { location } from "../lib/state.js";
import { Panel } from "./panels.js";

const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD"];

/** Home electricity rate and home location, used to price home charging. */
export function HomeChargingPanel(props: { vehicleId: string | undefined }) {
  const { data: settings } = useHomeCharging();
  const save = useSetHomeCharging();
  const { data: state } = useVehicleState(props.vehicleId);
  const vehicleLoc = location(state);

  // Drafts stay null until edited, so the saved values show by default.
  const [draftRate, setRate] = useState<string | null>(null);
  const [draftCurrency, setCurrency] = useState<string | null>(null);
  const rate = draftRate ?? (settings?.ratePerKwh != null ? String(settings.ratePerKwh) : "");
  const currency = draftCurrency ?? settings?.currency ?? "USD";
  const clearDrafts = () => {
    setRate(null);
    setCurrency(null);
  };

  const parsedRate = rate.trim() === "" ? null : Number(rate);
  const rateInvalid = parsedRate != null && (!Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 10);
  const dirty =
    settings != null &&
    (parsedRate !== settings.ratePerKwh || currency !== settings.currency);

  const base = {
    ratePerKwh: settings?.ratePerKwh ?? null,
    currency: settings?.currency ?? "USD",
    homeLat: settings?.homeLat ?? null,
    homeLon: settings?.homeLon ?? null,
  };

  return (
    <Panel title="Home charging">
      <div className="space-y-4 text-sm">
        <div className="space-y-2">
          <label htmlFor="home-rate" className="block text-[var(--text-secondary)]">
            Electricity rate
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="home-rate"
              inputMode="decimal"
              placeholder="0.15"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              aria-invalid={rateInvalid}
              className="w-28 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-right tabular-nums"
            />
            <select
              id="home-currency"
              aria-label="Currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="text-[var(--text-muted)]">per kWh</span>
            <button
              className="rounded-md bg-[var(--series-1)] px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50"
              disabled={!dirty || rateInvalid || save.isPending}
              onClick={() =>
                save.mutate({ ...base, ratePerKwh: parsedRate, currency }, { onSuccess: clearDrafts })
              }
            >
              Save
            </button>
          </div>
          {rateInvalid && (
            <p className="text-xs text-[var(--status-critical)]">Enter a rate between 0 and 10.</p>
          )}
          <p className="text-xs text-[var(--text-muted)]">
            Home sessions without a cost show an estimate: energy added × this rate. A cost you enter
            on a session always takes precedence. Energy added excludes charging losses, so the wall
            bill is typically 5–10% higher.
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-[var(--text-secondary)]">Home location</div>
          <p className="text-xs text-[var(--text-muted)]">
            Sessions within 150 m of your Rivian Wall Charger already count as home. Set a location
            if you charge at home on another charger.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums text-[var(--text-secondary)]">
              {settings?.homeLat != null && settings.homeLon != null
                ? `${settings.homeLat.toFixed(4)}, ${settings.homeLon.toFixed(4)}`
                : "Not set"}
            </span>
            <button
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
              disabled={!vehicleLoc || save.isPending}
              title={vehicleLoc ? undefined : "The vehicle's location isn't known yet"}
              onClick={() =>
                vehicleLoc && save.mutate({ ...base, homeLat: vehicleLoc.lat, homeLon: vehicleLoc.lon })
              }
            >
              Use vehicle's current location
            </button>
            {settings?.homeLat != null && (
              <button
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                onClick={() => save.mutate({ ...base, homeLat: null, homeLon: null })}
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {save.isError && (
          <p className="text-xs text-[var(--status-critical)]">Couldn't save. Try again.</p>
        )}
      </div>
    </Panel>
  );
}
