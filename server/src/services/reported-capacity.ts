/** Vehicle readings only; never infer capacity from charging energy or SOC. */
export interface CapacityReading { kwh: number; at: string }

export function reportedCapacity(readings: readonly CapacityReading[]) {
  const valid = readings.filter(r => Number.isFinite(r.kwh) && r.kwh > 0 && r.kwh <= 500 && Number.isFinite(Date.parse(r.at)))
    .map(r => ({ kwh: r.kwh, at: new Date(r.at).toISOString() }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const days = new Map<string, CapacityReading>();
  for (const reading of valid) days.set(reading.at.slice(0, 10), reading);
  return {
    latest: valid.at(-1) ?? null,
    reported: [...days].map(([day, reading]) => ({ day, ...reading })),
  };
}
