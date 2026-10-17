import { SplitBar, SplitLegend } from '../../components/SplitBar';
import { fmt } from '../../lib/state';

/**
 * Where a session's energy went: into the pack, or heating or cooling it.
 * Always the same height, so the panel doesn't grow when a charge ends.
 */
export function EnergySplit(props: {
  packKwh: number | null;
  thermalKwh: number | null;
  inProgress: boolean;
}) {
  const known = props.packKwh != null && props.thermalKwh != null;
  const segments = known
    ? [
        { key: 'pack', label: 'Stored', kwh: props.packKwh!, color: 'var(--series-1)' },
        {
          key: 'thermal',
          label: 'Heating & cooling',
          kwh: props.thermalKwh!,
          color: 'var(--series-2)',
        },
      ]
    : [];
  const why = props.inProgress
    ? 'Shown once the charge finishes'
    : 'Rivian didn’t report a breakdown for this session';
  return (
    <div className="mt-4 space-y-2 border-t border-(--border) pt-4">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-(--text-secondary)">Where the energy went</span>
        <span className="tabular-nums">
          {known ? `${fmt(props.packKwh! + props.thermalKwh!, 1)} kWh` : '—'}
        </span>
      </div>
      <SplitBar segments={segments} emptyLabel={why} />
      {known ? (
        <SplitLegend items={segments} />
      ) : (
        <p className="text-xs leading-4 text-(--text-muted)">{why}</p>
      )}
    </div>
  );
}
