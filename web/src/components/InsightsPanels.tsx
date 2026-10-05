import type { VehicleInsightsDto } from "@server/api-types.js";
import { useUnits } from "../api/hooks.js";
import { PARKED_USES, parkedSegments, parkedWindows, signalLabel, wifiBand, windowLabel } from "../lib/insights.js";
import { fmt } from "../lib/state.js";
import { Skeleton, useLoading } from "./loading.js";
import { SplitBar, SplitLegend } from "./SplitBar.js";
import { Row } from "./panels.js";

const time = (iso: string) =>
  new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Battery temperatures and cold-weather impact. */
export function BatteryEnergyPanel(props: { insights: VehicleInsightsDto | undefined; cellType?: string | null }) {
  const u = useUnits();
  const { cellTemps, cellTempsCurrent, coldWeather } = props.insights ?? {};
  const cold = coldWeather && coldWeather.rangeImpactKm > 0 ? coldWeather : null;

  return (
    <>
      <dl className="space-y-1 text-sm">
      <Row label="Battery cells" value={props.cellType ?? "—"} />
        <Row
          label="Cell temperature"
          value={
            cellTemps
              ? `${u.formatTemperature(cellTemps.avgC)} (${fmt(u.temperature(cellTemps.minC), 0)}–${fmt(u.temperature(cellTemps.maxC), 0)})`
              : "—"
          }
        />
        <Row
          label="Cold-weather impact"
          value={
            !coldWeather
              ? "—"
              : cold
                ? `−${u.formatDistance(cold.rangeImpactKm)} (${fmt(cold.coldSoc, 0)}% held back)`
                : "None"
          }
        />
      </dl>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        {cellTemps && !cellTempsCurrent
          ? `Cell temperatures as of ${time(cellTemps.at)}; the vehicle reports them only while awake.`
          : "Cell temperatures are reported only while the vehicle is awake."}
      </p>
    </>
  );
}

/** How the vehicle reaches the cloud: Wi-Fi and cellular. */
export function ConnectivityPanel(props: { insights: VehicleInsightsDto | undefined }) {
  const c = props.insights?.connectivity;
  const wifi = c?.wifi;
  const wifiDetail = wifi
    ? [wifi.ssid, wifiBand(wifi.frequencyMhz), signalLabel(wifi.rssiDbm) && `${signalLabel(wifi.rssiDbm)} (${String(wifi.rssiDbm).replace("-", "−")} dBm)`]
        .filter(Boolean)
        .join(" · ")
    : null;
  const cellular = c?.cellular ? [c.cellular.carrier, c.cellular.technology].filter(Boolean).join(" ") : null;

  return (
    <>
      <dl className="space-y-1 text-sm">
        <Row label="Wi-Fi" value={c ? (wifiDetail ?? "Not connected") : "—"} />
        <Row label="Cellular" value={c ? (cellular ?? "Not connected") : "—"} />
      </dl>
      {c && <p className="mt-2 text-xs text-[var(--text-muted)]">Reported {time(c.at)}</p>}
    </>
  );
}

/** Shown while the vehicle's navigation is active: where it's going and when it gets there. */
export function NavigationCard(props: { navigation: NonNullable<VehicleInsightsDto["navigation"]> }) {
  const u = useUnits();
  const n = props.navigation;
  const eta = n.etaAt ? new Date(n.etaAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  const minutesLeft = n.remainingS != null ? Math.round(n.remainingS / 60) : null;
  const facts = [
    n.remainingKm != null && `${u.formatDistance(n.remainingKm, n.remainingKm < 10 ? 1 : 0)} to go`,
    minutesLeft != null && (minutesLeft >= 60 ? `${Math.floor(minutesLeft / 60)} h ${minutesLeft % 60} min` : `${minutesLeft} min`),
    eta && `arrives ${eta}`,
    n.arrivalSoc != null && `${fmt(n.arrivalSoc, 0)}% on arrival`,
  ].filter(Boolean);

  return (
    <section className="card flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-[var(--accent)] px-4 py-3">
      <p className="min-w-0 truncate text-sm">
        <span className="text-[var(--text-secondary)]">Navigating to</span>{" "}
        <span className="font-medium">
          {n.destination.name ?? `${fmt(n.destination.lat, 4)}, ${fmt(n.destination.lon, 4)}`}
        </span>
      </p>
      <p className="text-sm tabular-nums text-[var(--text-secondary)]">{facts.join(" · ")}</p>
    </section>
  );
}

/** Energy used while parked: one bar per window, split by use. */
export function ParkedEnergyPanel(props: { insights: VehicleInsightsDto | undefined }) {
  const u = useUnits();
  const loading = useLoading();
  const windows = parkedWindows(props.insights?.parkedEnergy?.windows ?? []);
  if (!loading && windows.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">No parked energy reported yet.</p>;
  }
  return (
    <div className="space-y-3">
      {(loading ? [null, null] : windows).map((w, i) => (
        <div key={w?.minutes ?? i}>
          <div className="mb-1.5 flex items-baseline justify-between gap-4 text-sm">
            <span className="text-[var(--text-secondary)]">
              {w ? windowLabel(w.minutes) : <Skeleton className="w-[5em]" />}
            </span>
            <span className="tabular-nums">
              {w ? `${fmt(w.kwh, 1)} kWh · ${u.formatDistance(w.rangeKm)}` : <Skeleton className="w-[6em]" />}
            </span>
          </div>
          <SplitBar segments={w ? parkedSegments(w.uses) : []} emptyLabel="No parked energy used" />
        </div>
      ))}
      <SplitLegend items={[...PARKED_USES]} />
    </div>
  );
}
