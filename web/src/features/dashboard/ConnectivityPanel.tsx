import type { VehicleInsightsDto } from '@server/api-types';
import { Row } from '../../components/Panel';
import { dateTime } from '../../lib/format';
import { signalLabel, wifiBand } from '../../lib/insights';

/** How the vehicle reaches the cloud: Wi-Fi and cellular. */
export function ConnectivityPanel(props: { insights: VehicleInsightsDto | undefined }) {
  const c = props.insights?.connectivity;
  const wifi = c?.wifi;
  const wifiDetail = wifi
    ? [
        wifi.ssid,
        wifiBand(wifi.frequencyMhz),
        signalLabel(wifi.rssiDbm) &&
          `${signalLabel(wifi.rssiDbm)} (${String(wifi.rssiDbm).replace('-', '−')} dBm)`,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  const cellular = c?.cellular
    ? [c.cellular.carrier, c.cellular.technology].filter(Boolean).join(' ')
    : null;

  return (
    <>
      <dl className="space-y-1 text-sm">
        <Row label="Wi-Fi" value={c ? (wifiDetail ?? 'Not connected') : '—'} />
        <Row label="Cellular" value={c ? (cellular ?? 'Not connected') : '—'} />
      </dl>
      {c && <p className="mt-2 text-xs text-(--text-muted)">Reported {dateTime(c.at)}</p>}
    </>
  );
}
