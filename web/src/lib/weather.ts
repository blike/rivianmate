/** WMO weather codes, as Open-Meteo reports them. */
const CODES: [max: number, label: string][] = [
  [0, 'Clear'],
  [1, 'Mostly clear'],
  [2, 'Partly cloudy'],
  [3, 'Overcast'],
  [48, 'Fog'],
  [55, 'Drizzle'],
  [57, 'Freezing drizzle'],
  [61, 'Light rain'],
  [63, 'Rain'],
  [65, 'Heavy rain'],
  [67, 'Freezing rain'],
  [71, 'Light snow'],
  [73, 'Snow'],
  [77, 'Heavy snow'],
  [80, 'Light showers'],
  [81, 'Showers'],
  [82, 'Heavy showers'],
  [86, 'Snow showers'],
  [95, 'Thunderstorms'],
  [99, 'Thunderstorms with hail'],
];

export function weatherLabel(code: number): string {
  return CODES.find(([max]) => code <= max)?.[1] ?? 'Unknown';
}

export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';

/** What to draw for a WMO code. */
export function weatherKind(code: number): WeatherKind {
  if (code <= 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code <= 48) return 'fog';
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  return 'rain';
}

/**
 * Whether the sun is up at `ms` over a place: its elevation from the
 * standard low-precision solar position, good to a few minutes.
 */
export function isDaytime(lat: number, lon: number, ms: number): boolean {
  const rad = Math.PI / 180;
  const days = ms / 86400_000 - 10957.5; // since J2000
  const meanLon = (280.46 + 0.9856474 * days) % 360;
  const anomaly = ((357.528 + 0.9856003 * days) % 360) * rad;
  const eclLon = (meanLon + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * rad;
  const obliquity = (23.439 - 0.0000004 * days) * rad;
  const decl = Math.asin(Math.sin(obliquity) * Math.sin(eclLon));
  const ra = Math.atan2(Math.cos(obliquity) * Math.sin(eclLon), Math.cos(eclLon));
  const sidereal = (280.46061837 + 360.98564736629 * days + lon) * rad;
  const hourAngle = sidereal - ra;
  const elevation = Math.asin(
    Math.sin(lat * rad) * Math.sin(decl) +
      Math.cos(lat * rad) * Math.cos(decl) * Math.cos(hourAngle),
  );
  // The sun's disc and refraction put sunrise a little below the horizon.
  return elevation > -0.833 * rad;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** The compass point the wind blows from. */
export function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}
