import type { ChargingSessionDto } from '@server/api-types';
import { SplitBar, SplitLegend, type SplitSegment } from '../../components/SplitBar';
import { fmt } from '../../lib/state';

/**
 * Where a session's energy went: into the pack, or heating or cooling it
 * (Rivian's split), or lost on the way in (TeslaMate's, which can't tell the
 * two apart). Always the same height, so the panel doesn't grow when a charge ends.
 */
export function EnergySplit(props: {
  session: Pick<
    ChargingSessionDto,
    'source' | 'energyKwh' | 'packKwh' | 'thermalKwh' | 'lossKwh' | 'endedAt' | 'isPublic'
  >;
}) {
  const s = props.session;
  const segments: SplitSegment[] =
    s.source === 'teslamate'
      ? s.energyKwh != null && s.lossKwh != null
        ? [
            { key: 'pack', label: 'Stored', kwh: s.energyKwh, color: 'var(--series-1)' },
            { key: 'loss', label: 'Charging losses', kwh: s.lossKwh, color: 'var(--series-3)' },
          ]
        : []
      : s.packKwh != null && s.thermalKwh != null
        ? [
            { key: 'pack', label: 'Stored', kwh: s.packKwh, color: 'var(--series-1)' },
            {
              key: 'thermal',
              label: 'Heating & cooling',
              kwh: s.thermalKwh,
              color: 'var(--series-2)',
            },
          ]
        : [];
  const known = segments.length > 0;
  const total = segments.reduce((sum, seg) => sum + seg.kwh, 0);
  // A TeslaMate session is public only when it was DC fast charging.
  const why = !s.endedAt
    ? 'Shown once the charge finishes'
    : s.source === 'teslamate'
      ? s.isPublic
        ? 'Not measured for DC fast charging'
        : 'TeslaMate didn’t record the energy drawn for this session'
      : s.source === 'electrafi'
        ? 'ElectraFi exports don’t include a breakdown'
        : 'Rivian didn’t report a breakdown for this session';
  return (
    <div className="mt-4 space-y-2 border-t border-(--border) pt-4">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-(--text-secondary)">Where the energy went</span>
        <span className="tabular-nums">{known ? `${fmt(total, 1)} kWh` : '—'}</span>
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
