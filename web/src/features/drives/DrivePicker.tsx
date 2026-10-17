import type { DriveDto } from '@server/api-types';
import { useMemo } from 'react';
import { useUnits } from '../../api/hooks';
import { RecordPicker } from '../../components/RecordPicker';
import { drivesByDay } from '../../lib/drives';
import { clock } from '../../lib/format';
import { driveFacts, driveTitle } from './format';

/** On narrow screens, a picker up top stands in for the list. */
export function DrivePicker(props: {
  drives: DriveDto[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const u = useUnits();
  const groups = useMemo(
    () =>
      drivesByDay(props.drives).map((day) => ({
        key: day.key,
        label: day.label,
        summary: `${day.drives.length} drive${day.drives.length === 1 ? '' : 's'} · ${u.formatDistance(day.distanceKm)}`,
        items: day.drives.map((d) => ({
          id: d.id,
          time: clock(d.startedAt),
          title: driveTitle(d),
          detail: driveFacts(d, u),
          value: u.formatDistance(d.distanceKm, 1),
          live: !d.endedAt,
        })),
      })),
    [props.drives, u],
  );
  return (
    <RecordPicker
      label="Drive"
      groups={groups}
      selectedId={props.selectedId}
      onSelect={props.onSelect}
      className="sticky top-2 z-20 lg:hidden"
    />
  );
}
