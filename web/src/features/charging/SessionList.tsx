import { useMemo } from 'react';
import type { ChargingSessionDto } from '../../api/client';
import { InProgressTag } from '../../components/InProgressTag';
import { chargerLabel, sessionCity } from '../../lib/charging';
import { groupByDay } from '../../lib/drives';
import { clock } from '../../lib/format';
import { fmt } from '../../lib/state';
import { chargeStart, dayTotals, sessionFacts } from './sessions';

/** Sessions by day, newest first, each day with its energy and cost. */
export function SessionList(props: {
  sessions: ChargingSessionDto[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  // Listed by when each started charging, which can be hours after plug-in.
  const days = useMemo(() => groupByDay(props.sessions, new Date(), chargeStart), [props.sessions]);
  return (
    <div>
      {days.map((day) => {
        return (
          <section key={day.key}>
            <h4 className="sticky top-0 z-10 flex items-baseline justify-between gap-3 border-b border-(--border) bg-(--surface-1) px-4 py-2 text-xs">
              <span className="font-medium uppercase tracking-wide text-(--text-muted)">
                {day.label}
              </span>
              <span className="tabular-nums text-(--text-muted)">{dayTotals(day.items)}</span>
            </h4>
            <ul>
              {day.items.map((s) => (
                <SessionItem
                  key={s.id}
                  session={s}
                  selected={props.selectedId === s.id}
                  onSelect={() => props.onSelect(s.id)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function SessionItem(props: {
  session: ChargingSessionDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const s = props.session;

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
        <span
          className="text-xs tabular-nums text-(--text-muted)"
          title={s.chargingStartedAt ? `Plugged in ${clock(s.startedAt)}` : undefined}
        >
          {clock(chargeStart(s))}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm">
            <span className={s.isHome || s.location ? 'font-medium' : ''}>{chargerLabel(s)}</span>
            {sessionCity(s) && <span className="text-(--text-muted)"> · {s.city}</span>}
            {!s.endedAt && (
              <InProgressTag label={s.chargingSince ? 'Charging' : 'Plugged in'} className="ml-2" />
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs tabular-nums text-(--text-muted)">
            {sessionFacts(s)}
          </span>
        </span>
        <span className="text-sm font-medium tabular-nums">
          {s.energyKwh != null ? `${fmt(s.energyKwh, 1)} kWh` : '—'}
        </span>
      </button>
    </li>
  );
}
