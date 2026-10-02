/** Parked-energy windows worth showing: whole hours, longest first. */
export function parkedWindows<T extends { minutes: number }>(windows: readonly T[]): T[] {
  return windows.filter((w) => w.minutes >= 60 && w.minutes % 60 === 0).sort((a, b) => b.minutes - a.minutes);
}

export function windowLabel(minutes: number): string {
  return `Last ${minutes / 60} h`;
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

/** Where parked energy went, e.g. "System 1.7 · Climate 0.4 kWh"; null if nothing used. */
export function parkedUses(uses: { climate: number; system: number; gearGuardAndOutlets: number }): string | null {
  const parts = [
    { label: "System", kwh: uses.system },
    { label: "Climate", kwh: uses.climate },
    { label: "Gear Guard & outlets", kwh: uses.gearGuardAndOutlets },
  ].filter((p) => p.kwh >= 0.05);
  if (parts.length === 0) return null;
  return `${parts.map((p) => `${p.label} ${p.kwh.toFixed(1)}`).join(" · ")} kWh`;
}
