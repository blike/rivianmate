import type { WallboxDto } from '../../api/client';
import { Panel, Row } from '../../components/Panel';
import { fmt, titleCase } from '../../lib/state';

export function WallboxPanel(props: { wallbox: WallboxDto }) {
  const wb = props.wallbox;
  return (
    <Panel title={wb.name ?? wb.wallboxId}>
      <dl className="space-y-1 text-sm">
        <Row label="Status" value={titleCase(wb.latest?.chargingStatus ?? null)} />
        <Row
          label="Power"
          value={
            wb.latest?.power != null
              ? `${fmt(wb.latest.power, 1)} kW / ${fmt(wb.maxPower, 1)} kW`
              : '—'
          }
        />
        <Row
          label="Output"
          value={
            wb.latest?.currentAmps != null
              ? `${fmt(wb.latest.currentAmps, 0)} A @ ${fmt(wb.latest.currentVoltage, 0)} V`
              : '—'
          }
        />
        <Row label="Model" value={wb.model ?? '—'} />
        <Row label="Firmware" value={wb.softwareVersion ?? '—'} />
      </dl>
    </Panel>
  );
}
