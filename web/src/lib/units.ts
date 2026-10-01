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

  const distanceUnit = miles ? "mi" : "km";
  const speedUnit = miles ? "mph" : "km/h";
  const temperatureUnit = fahrenheit ? "°F" : "°C";

  return {
    units,
    distanceUnit,
    speedUnit,
    temperatureUnit,
    distance,
    temperature,
    /** e.g. "212 mi" — `km` in kilometres. */
    formatDistance: (km: number | null | undefined, digits = 0) =>
      km == null ? "—" : `${fmt(distance(km), digits)} ${distanceUnit}`,
    /** `kmh` in km/h (same conversion factor as distance). */
    formatSpeed: (kmh: number | null | undefined, digits = 0) =>
      kmh == null ? "—" : `${fmt(distance(kmh), digits)} ${speedUnit}`,
    /** `c` in °C. */
    formatTemperature: (c: number | null | undefined, digits = 0) =>
      c == null ? "—" : `${fmt(temperature(c), digits)} ${temperatureUnit}`,
  };
}

export type UnitFormatter = ReturnType<typeof unitFormatter>;
