import type { ChargingCurvePointDto } from "@server/api-types.js";

/** Trim only outside recorded charging; preserve pauses within it and live forecasts. */
export function chargingCurveWindow(curve: readonly ChargingCurvePointDto[]) {
  const recorded = curve.filter(p => !p.projected).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const first = recorded.findIndex(p => p.powerKw != null && Number.isFinite(p.powerKw) && p.powerKw > 0);
  const last = recorded.reduce((index, p, i) => p.powerKw != null && Number.isFinite(p.powerKw) && p.powerKw > 0 ? i : index, -1);
  // SOC alone doesn't establish charging boundaries. Keep it as an explicit fallback.
  const active = first < 0 ? recorded : recorded.slice(first, last + 1);
  const end = active.at(-1)?.ts;
  const forecast = curve.filter(p => p.projected && (!end || Date.parse(p.ts) > Date.parse(end)))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const points = [...active, ...forecast];
  return { points, originMs: points[0] ? Date.parse(points[0].ts) : null };
}
