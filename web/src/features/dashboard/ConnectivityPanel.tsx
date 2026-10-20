import type { VehicleInsightsDto } from '@server/api-types';
import { Row } from '../../components/Panel';
import { signalLabel, wifiBand } from '../../lib/insights';

/** How the vehicle reaches the cloud, as Wi-Fi and cellular rows for a `<dl>`. */
export function ConnectivityRows(props: { insights: VehicleInsightsDto | undefined }) {
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
      <Row label="Wi-Fi" value={c ? (wifiDetail ?? 'Not connected') : '—'} />
      <Row label="Cellular" value={c ? (cellular ?? 'Not connected') : '—'} />
    </>
  );
}
