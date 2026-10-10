import { HOME_RADIUS_KM } from "@server/services/home-charging.js";
import { useState } from "react";
import { useHomeCharging, useSetHomeCharging, useUnits, useVehicleState } from "../api/hooks.js";
import { formatMoney } from "../lib/charging.js";
import { haversineKm } from "../lib/geo.js";
import { location } from "../lib/state.js";
import { SettingRow, SettingsGroup, secondaryButton } from "./settings.js";

const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD"];
/** A typical overnight top-up, to put the rate in familiar terms. */
const EXAMPLE_KWH = 50;

/** Home electricity rate and home location, used to price home charging. */
export function HomeChargingPanel(props: { vehicleId: string | undefined }) {
  const { data: settings } = useHomeCharging();
  const save = useSetHomeCharging();
  const { data: state } = useVehicleState(props.vehicleId);
  const u = useUnits();
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
  const home = settings?.homeLat != null && settings.homeLon != null ? { lat: settings.homeLat, lon: settings.homeLon } : null;
  const awayKm = home && vehicleLoc ? haversineKm(home.lat, home.lon, vehicleLoc.lat, vehicleLoc.lon) : null;

  return (
    <>
      <SettingsGroup
        title="Electricity"
      >
        <SettingRow
          label="Home rate"
          htmlFor="home-rate"
          description={
            rateInvalid ? (
              <span className="text-[var(--status-critical)]">Enter a rate between 0 and 10.</span>
            ) : parsedRate != null ? (
              `A ${EXAMPLE_KWH} kWh charge costs about ${formatMoney(String(parsedRate * EXAMPLE_KWH), currency)}. Costs you enter on a session always win.`
            ) : (
              "Set a rate to estimate what home sessions cost."
            )
          }
        >
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (dirty && !rateInvalid) save.mutate({ ...base, ratePerKwh: parsedRate, currency }, { onSuccess: clearDrafts });
            }}
          >
            <div className="flex items-center rounded-md border border-[var(--border)] bg-[var(--surface-2)] focus-within:border-[var(--text-muted)]">
              <input
                id="home-rate"
                inputMode="decimal"
                placeholder="0.15"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                aria-invalid={rateInvalid}
                className="w-20 bg-transparent py-1.5 pl-2.5 text-right text-sm tabular-nums outline-none"
              />
              <span className="pl-1 pr-2 text-sm text-[var(--text-muted)]">/ kWh</span>
              <select
                aria-label="Currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="border-l border-[var(--border)] bg-transparent py-1.5 pl-2 pr-1 text-sm outline-none"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            {dirty && (
              <button type="submit" className="btn-primary" disabled={rateInvalid || save.isPending}>
                Save
              </button>
            )}
          </form>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Home"
        note="Sessions at your Rivian Wall Charger always count as home. Set a location if you charge at home on another charger."
      >
        <SettingRow
          label="Home location"
          description={
            home ? (
              <>
                <span className="tabular-nums">
                  {home.lat.toFixed(4)}, {home.lon.toFixed(4)}
                </span>
                {awayKm != null &&
                  (awayKm <= HOME_RADIUS_KM ? " · Vehicle is home now" : ` · Vehicle is ${u.formatDistance(awayKm, awayKm < 10 ? 1 : 0)} away`)}
              </>
            ) : (
              `Not set. Sessions within ${Math.round(HOME_RADIUS_KM * 1000)} m of it will count as home.`
            )
          }
        >
          <button
            className={secondaryButton}
            disabled={!vehicleLoc || save.isPending}
            title={vehicleLoc ? undefined : "The vehicle's location isn't known yet"}
            onClick={() => vehicleLoc && save.mutate({ ...base, homeLat: vehicleLoc.lat, homeLon: vehicleLoc.lon })}
          >
            {home ? "Set to vehicle’s location" : "Use vehicle’s location"}
          </button>
          {home && (
            <button className={secondaryButton} onClick={() => save.mutate({ ...base, homeLat: null, homeLon: null })}>
              Clear
            </button>
          )}
        </SettingRow>
      </SettingsGroup>

      {save.isError && (
        <p role="alert" className="text-xs text-[var(--status-critical)]">
          Couldn’t save. Try again.
        </p>
      )}
    </>
  );
}
