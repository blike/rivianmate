import type { UnitPreferences } from "@server/api-types.js";
import { fmt } from "./state.js";

export const DEFAULT_UNITS: UnitPreferences = { distance: "mi", temperature: "F" };

const KM_TO_MI = 0.621371;

/**
 * Display conversions. All inputs are in the units Rivian/the server store:
 * kilometres, km/h and °C.
 */
export function unitFormatter(units: UnitPreferences) {
  const miles = units.distance === "mi";
  const fahrenheit = units.temperature === "F";

  const distance = (km: number | null | undefined): number | null =>
    km == null ? null : miles ? km * KM_TO_MI : km;
  const temperature = (c: number | null | undefined): number | null =>
    c == null ? null : fahrenheit ? (c * 9) / 5 + 32 : c;

  const elevation = (m: number | null | undefined): number | null =>
    m == null ? null : miles ? m * 3.28084 : m;

  const distanceUnit = miles ? "mi" : "km";
  const elevationUnit = miles ? "ft" : "m";
  const pressureUnit = miles ? "psi" : "bar";
  /** Tire pressure: Rivian reports bar. */
  const pressure = (bar: number | null | undefined): number | null =>
    bar == null ? null : miles ? bar * 14.5038 : bar;
  const speedUnit = miles ? "mph" : "km/h";
  /**
   * Driving efficiency: mi/kWh for miles (higher is better), kWh/100 km
   * for kilometres (lower is better), as each region usually quotes it.
   */
  const efficiency = (distanceKm: number | null | undefined, energyKwh: number | null | undefined): number | null => {
    if (distanceKm == null || energyKwh == null || !(energyKwh > 0) || !(distanceKm > 0)) return null;
    return miles ? (distanceKm * KM_TO_MI) / energyKwh : (energyKwh / distanceKm) * 100;
  };
  const efficiencyUnit = miles ? "mi/kWh" : "kWh/100 km";
  const efficiencyDigits = miles ? 2 : 1;
  const temperatureUnit = fahrenheit ? "°F" : "°C";

  return {
    units,
    distanceUnit,
    elevationUnit,
    pressureUnit,
    speedUnit,
    temperatureUnit,
    efficiencyUnit,
    efficiencyDigits,
    /** Whether a larger efficiency figure is the better one (mi/kWh). */
    efficiencyHigherIsBetter: miles,
    distance,
    temperature,
    elevation,
    pressure,
    efficiency,
    /** e.g. "212 mi" — `km` in kilometres. */
    formatDistance: (km: number | null | undefined, digits = 0) =>
      km == null ? "—" : `${fmt(distance(km), digits)} ${distanceUnit}`,
    /** `kmh` in km/h (same conversion factor as distance). */
    formatSpeed: (kmh: number | null | undefined, digits = 0) =>
      kmh == null ? "—" : `${fmt(distance(kmh), digits)} ${speedUnit}`,
    /** Range added per hour of charging, e.g. "+19 mi/h"; `kmh` in km/h. */
    formatChargeRate: (kmh: number | null | undefined) =>
      kmh == null ? "—" : `+${fmt(distance(kmh), 0)} ${distanceUnit}/h`,
    formatPressure: (bar: number | null | undefined) =>
      bar == null ? "—" : `${fmt(pressure(bar), miles ? 0 : 2)} ${pressureUnit}`,
    /** `m` in metres; feet when distances are in miles. */
    formatElevation: (m: number | null | undefined) =>
      m == null ? "—" : `${fmt(elevation(m), 0)} ${elevationUnit}`,
    /** e.g. "2.41 mi/kWh" or "25.8 kWh/100 km"; see `efficiency`. */
    formatEfficiency: (distanceKm: number | null | undefined, energyKwh: number | null | undefined) => {
      const value = efficiency(distanceKm, energyKwh);
      return value == null ? "—" : `${fmt(value, efficiencyDigits)} ${efficiencyUnit}`;
    },
    /** `c` in °C. */
    formatTemperature: (c: number | null | undefined, digits = 0) =>
      c == null ? "—" : `${fmt(temperature(c), digits)} ${temperatureUnit}`,
  };
}

export type UnitFormatter = ReturnType<typeof unitFormatter>;
