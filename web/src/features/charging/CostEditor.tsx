import { useState } from 'react';
import type { ChargingSessionDto } from '../../api/client';
import { formatMoney } from '../../lib/charging';

/** The session's cost, edited in place: the recorded one, or the home-rate estimate in muted text. */
export function CostEditor(props: {
  session: ChargingSessionDto;
  onSave: (cost: string | null) => void;
}) {
  const s = props.session;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(s.cost ?? '');

  if (!editing) {
    return (
      <button
        className="tabular-nums underline decoration-(--text-muted) decoration-dotted underline-offset-4 hover:decoration-(--text-primary)"
        onClick={() => {
          setValue(s.cost ?? '');
          setEditing(true);
        }}
        title="Edit cost"
      >
        {s.cost != null ? (
          formatMoney(s.cost, s.currency)
        ) : s.estimatedCost != null ? (
          <span
            className="text-(--text-secondary)"
            title="Estimated from your home electricity rate"
          >
            ≈ {formatMoney(s.estimatedCost, s.currency)}
          </span>
        ) : (
          <span className="text-(--text-muted)">Add</span>
        )}
      </button>
    );
  }
  return (
    <input
      autoFocus
      inputMode="decimal"
      aria-label="Session cost"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const trimmed = value.trim();
        if (trimmed === '') props.onSave(null);
        else if (!Number.isNaN(Number(trimmed))) props.onSave(trimmed);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setEditing(false);
      }}
      className="w-24 rounded border border-(--border) bg-(--surface-2) px-1.5 py-0.5 text-base font-semibold"
    />
  );
}
