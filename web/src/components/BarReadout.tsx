import {
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { fmt } from '../lib/state';
import type { SplitSegment } from './SplitBar';

/** What a parked bar's width can't say: the window it covers and what it spent. */
export interface BarReading {
  /** What the bar covers: a window's length, or the night it ran. */
  heading: string;
  /** The window's total, in kWh. */
  total: number;
  /** Each use that drew energy, in legend order; empty where there's no split. */
  uses: SplitSegment[];
  /** Said instead of the uses where the total isn't split. */
  unsplit: string;
}

/**
 * One bar's reading at a time, and only while someone is on it: pointing at a
 * bar opens its reading, tapping it opens it, tabbing to it opens it. A tap
 * anywhere else, Escape, or focus leaving the group puts it away. A phone
 * doesn't focus what it taps, so a tap elsewhere is caught on the document
 * rather than waited for as a blur.
 */
export function useBarReadout<T>() {
  const [open, setOpen] = useState<T | null>(null);
  const group = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open == null) return;
    const away = (e: PointerEvent) => {
      if (!group.current?.contains(e.target as Node)) setOpen(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return {
    /** The bar whose reading is showing, or null when none is. */
    open,
    /** The element around the bars: the reading draws over its top edge. */
    groupProps: {
      ref: group,
      // A finger's pointer leaves the bar as the tap ends, so only a mouse leaving closes it.
      onPointerLeave: (e: ReactPointerEvent) => {
        if (e.pointerType === 'mouse') setOpen(null);
      },
      onBlur: (e: ReactFocusEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(null);
      },
    },
    /** The bar itself: point at it, tab to it or tap it to read it. */
    barProps: (bar: T) => ({
      onClick: () => setOpen(bar),
      onPointerEnter: () => setOpen(bar),
      onFocus: () => setOpen(bar),
    }),
  };
}

/**
 * The reading a parked bar's width can't say, drawn over the top edge of the
 * bars: the window, its total, and what the total was spent on. It says what
 * the bar's own label says, so it's kept out of the accessibility tree rather
 * than read out twice.
 */
export function BarReadout(props: { reading: BarReading }) {
  const reading = props.reading;
  return (
    <div
      aria-hidden
      className="bar-readout rounded-lg border border-(--border) bg-(--surface-2) px-3 py-2 text-xs shadow-lg"
    >
      <div className="text-(--text-primary)">{reading.heading}</div>
      <div className="mt-1.5 space-y-1 border-t border-(--border) pt-1.5">
        <ReadingRow label="Total" value={fmt(reading.total, 1)} />
        {reading.uses.length > 0 ? (
          reading.uses.map((use) => (
            <ReadingRow key={use.key} label={use.label} value={fmt(use.kwh, 1)} color={use.color} />
          ))
        ) : (
          <div className="text-(--text-muted)">{reading.unsplit}</div>
        )}
      </div>
    </div>
  );
}

/** One line of a reading: what drew the energy, and how much. */
function ReadingRow(props: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="flex items-center gap-2 text-(--text-secondary)">
        {props.color && (
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: props.color }} />
        )}
        {props.label}
      </span>
      <span className="tabular-nums text-(--text-primary)">{props.value} kWh</span>
    </div>
  );
}
