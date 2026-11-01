import type { DriveDto, DrivePlaceDto } from '@server/api-types';
import { useMemo } from 'react';
import { useUnits } from '../../api/hooks';
import { InProgressTag } from '../../components/InProgressTag';
import { drivesByDay } from '../../lib/drives';
import { clock } from '../../lib/format';
import { placeName, driveFacts, destination } from './format';

/** Home or a saved location, which stand out from plain addresses. */
const savedPlace = (p: DrivePlaceDto | null) => p != null && (p.isHome || p.locationId != null);

/** Drives by day, newest first, each day with its total. */
export function DriveList(props: {
  drives: DriveDto[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const u = useUnits();
  const days = useMemo(() => drivesByDay(props.drives), [props.drives]);
  return (
    <div>
      {days.map((day) => (
        <section key={day.key}>
          <h4 className="sticky top-0 z-10 flex items-baseline justify-between gap-3 border-b border-(--border) bg-(--surface-1) px-4 py-2 text-xs">
            <span className="font-medium uppercase tracking-wide text-(--text-muted)">
              {day.label}
            </span>
            <span className="tabular-nums text-(--text-muted)">
              {day.drives.length} drive{day.drives.length === 1 ? '' : 's'} ·{' '}
              {u.formatDistance(day.distanceKm)}
            </span>
          </h4>
          <ul>
            {day.drives.map((d) => (
              <DriveItem
                key={d.id}
                drive={d}
                selected={props.selectedId === d.id}
                onSelect={() => props.onSelect(d.id)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DriveItem(props: { drive: DriveDto; selected: boolean; onSelect: () => void }) {
  const u = useUnits();
  const d = props.drive;
  const to = destination(d);
  const navigating = !d.endedAt && to != null;

  return (
    <li>
      <button
        onClick={props.onSelect}
        aria-current={props.selected ? 'true' : undefined}
        className={`relative grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-2.5 text-left transition-colors hover:bg-(--surface-2) ${
          props.selected ? 'bg-(--surface-2)' : ''
        }`}
      >
        {props.selected && (
          <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-(--accent)" />
        )}
        <span className="text-xs tabular-nums text-(--text-muted)">{clock(d.startedAt)}</span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <span
              className="min-w-0 truncate"
              title={
                to == null
                  ? `From ${d.start?.address ?? d.start?.label ?? '—'}`
                  : `${d.start?.address ?? d.start?.label ?? '—'} → ${d.end?.address ?? to}`
              }
            >
              {navigating ? (
                <span>{to}</span>
              ) : (
                <>
                  {to == null && <span className="text-(--text-muted)">From </span>}
                  <span className={savedPlace(d.start) ? 'font-medium' : ''}>
                    {d.start ? placeName(d.start) : '—'}
                  </span>
                  {to != null && (
                    <>
                      <span className="text-(--text-muted)"> → </span>
                      <span className={savedPlace(d.end) ? 'font-medium' : ''}>{to}</span>
                    </>
                  )}
                </>
              )}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs tabular-nums text-(--text-muted)">
            {!d.endedAt && <InProgressTag className="mr-1.5" />}
            {driveFacts(d, u)}
          </span>
        </span>
        <span className="text-sm font-medium tabular-nums">
          {u.formatDistance(d.distanceKm, 1)}
        </span>
      </button>
    </li>
  );
}
