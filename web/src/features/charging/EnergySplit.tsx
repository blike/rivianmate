import { SplitBar, SplitLegend } from '../../components/SplitBar';
import { fmt } from '../../lib/state';

/** Where a session's energy went: into the pack, or heating or cooling it. */
export function EnergySplit(props: { packKwh: number; thermalKwh: number }) {
  const segments = [
    { key: 'pack', label: 'Stored', kwh: props.packKwh, color: 'var(--series-1)' },
    { key: 'thermal', label: 'Heating & cooling', kwh: props.thermalKwh, color: 'var(--series-2)' },
  ];
  return (
    <div className="mt-4 space-y-2 border-t border-(--border) pt-4">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-(--text-secondary)">Where the energy went</span>
        <span className="tabular-nums">{fmt(props.packKwh + props.thermalKwh, 1)} kWh</span>
      </div>
      <SplitBar segments={segments} />
      <SplitLegend items={segments.map((s) => ({ ...s, kwh: s.kwh }))} />
    </div>
  );
}
