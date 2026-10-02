/** Parked-energy windows worth showing: whole hours, longest first. */
export function parkedWindows<T extends { minutes: number }>(windows: readonly T[]): T[] {
  return windows.filter((w) => w.minutes >= 60 && w.minutes % 60 === 0).sort((a, b) => b.minutes - a.minutes);
}

export function windowLabel(minutes: number): string {
  const hours = minutes / 60;
  return `Last ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

export function wifiBand(frequencyMhz: number | null): string | null {
  if (frequencyMhz == null) return null;
  if (frequencyMhz < 3000) return "2.4 GHz";
  if (frequencyMhz < 5925) return "5 GHz";
  return "6 GHz";
}

/** Wi-Fi signal strength in words, from RSSI. */
export function signalLabel(rssiDbm: number | null): string | null {
  if (rssiDbm == null) return null;
  if (rssiDbm >= -60) return "Strong";
  if (rssiDbm >= -70) return "Good";
  if (rssiDbm >= -80) return "Fair";
  return "Weak";
}

export const PARKED_USES = [
  { key: "system", label: "System", color: "var(--series-1)" },
  { key: "climate", label: "Climate", color: "var(--series-2)" },
  { key: "gearGuardAndOutlets", label: "Gear Guard & outlets", color: "var(--series-3)" },
] as const;

/** A window's uses that drew energy, in legend order, for the split bar. */
export function parkedSegments(uses: { climate: number; system: number; gearGuardAndOutlets: number }) {
  return PARKED_USES.map((u) => ({ ...u, kwh: uses[u.key] })).filter((s) => s.kwh >= 0.05);
}
