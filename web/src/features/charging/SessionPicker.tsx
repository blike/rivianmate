import { useMemo } from 'react';
import type { ChargingSessionDto } from '../../api/client';
import { RecordPicker } from '../../components/RecordPicker';
import { chargerLabel, sessionCity } from '../../lib/charging';
import { groupByDay } from '../../lib/drives';
import { clock } from '../../lib/format';
import { fmt } from '../../lib/state';
import { chargeStart, dayTotals, sessionFacts } from './sessions';

/** On narrow screens, a picker up top stands in for the list. */
export function SessionPicker(props: {
  sessions: ChargingSessionDto[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  older?: { has: boolean; loading: boolean; load: () => void };
}) {
  const groups = useMemo(
    () =>
      groupByDay(props.sessions, new Date(), chargeStart).map((day) => ({
        key: day.key,
        label: day.label,
        summary: dayTotals(day.items),
        items: day.items.map((s) => ({
          id: s.id,
          time: clock(chargeStart(s)),
          title: sessionCity(s) ? `${chargerLabel(s)} · ${s.city}` : chargerLabel(s),
          detail: sessionFacts(s),
          value: s.energyKwh != null ? `${fmt(s.energyKwh, 1)} kWh` : undefined,
          live: !s.endedAt,
          liveLabel: s.chargingSince ? 'Charging' : 'Plugged in',
        })),
      })),
    [props.sessions],
  );
  return (
    <RecordPicker
      label="Session"
      groups={groups}
      selectedId={props.selectedId}
      onSelect={props.onSelect}
      older={props.older}
      className="sticky top-2 z-20 lg:hidden"
    />
  );
}
