import {
  parkedSegments,
  parkedUnsplit,
  windowLabel,
  type ParkedEnergyWindow,
  type ParkedNight,
} from '../lib/insights';
import { fmt } from '../lib/state';
import { BarReadout, useBarReadout, type BarReading } from './BarReadout';

/** The day under a bar, in the device's own calendar: "Wed, Oct 8". */
function dayLabel(day: Date): string {
  return day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

/** How long the window Rivian reported runs, in words: "the last 8 hours". */
function windowPhrase(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) return windowLabel(minutes).replace('Last', 'the last');
  return `${minutes} minutes`;
}

/** A window's uses in words, for the bars' labels: "System 1.6 kWh, Climate 0.4 kWh". */
function usesText(window: ParkedEnergyWindow): string {
  const segments = window.uses ? parkedSegments(window.uses) : [];
  return segments.map((s) => `${s.label} ${fmt(s.kwh, 1)} kWh`).join(', ') || 'not split by use';
}

/** A night's reading, as its readout prints it: the night, its total, its uses. */
function readingOf(night: ParkedNight, w: ParkedEnergyWindow): BarReading {
  return {
    heading: `${dayLabel(night.date)} · ${windowPhrase(w.minutes)}`,
    total: w.kwh,
    uses: w.uses ? parkedSegments(w.uses) : [],
    unsplit: parkedUnsplit(w.uses),
  };
}

/**
 * Parked energy as one bar per night across the last week, split into the same
 * uses as the window bars above it, so a week's pattern reads at a glance. The
 * nights are the device's own calendar days (see parkedNights) and a night the
 * source didn't report keeps an empty slot rather than closing the gap. The
 * totals sit above the bars so the shape is read against a number, and a bar's
 * own numbers are read by pointing at it, tapping it or tabbing to it: a small
 * night is a sliver three pixels wide.
 */
export function ParkedWeek(props: { nights: ParkedNight[] }) {
  const nights = props.nights;
  const readout = useBarReadout<ParkedNight>();
  if (nights.length === 0) return null;
  const reported = nights.flatMap((night) => (night.window ? [night.window] : []));
  const total = reported.reduce((sum, w) => sum + w.kwh, 0);
  const most = Math.max(0, ...reported.map((w) => w.kwh));
  const newest = nights.at(-1)?.key;
  const open = readout.open;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-4 text-sm">
        <span className="text-(--text-secondary)">Last {nights.length} nights</span>
        <span className="tabular-nums">
          {fmt(total, 1)} kWh over {reported.length} {reported.length === 1 ? 'night' : 'nights'}
        </span>
      </div>
      <div className="relative" {...readout.groupProps}>
        {open?.window && <BarReadout reading={readingOf(open, open.window)} />}
        <div className="flex items-end gap-2">
          {nights.map((night) => {
            const w = night.window;
            const segments = w?.uses ? parkedSegments(w.uses) : [];
            const day = dayLabel(night.date);
            return (
              <div
                key={night.key}
                data-night={night.key}
                className="flex min-w-0 flex-1 flex-col items-center gap-1"
              >
                {w ? (
                  <button
                    type="button"
                    className="bar-readout__trigger flex h-10 w-full items-end"
                    aria-label={`${day}: ${fmt(w.kwh, 1)} kWh used while parked over ${windowPhrase(
                      w.minutes,
                    )}, ${usesText(w)}`}
                    {...readout.barProps(night)}
                  >
                    {w.kwh > 0 && (w.uses == null || segments.length > 0) ? (
                      <div
                        className="flex w-full flex-col-reverse overflow-hidden rounded-t-[4px]"
                        style={{ height: `max(3px, ${(w.kwh / most) * 100}%)` }}
                      >
                        {(segments.length > 0
                          ? segments
                          : [{ key: 'all', kwh: w.kwh, color: 'var(--series-1)' }]
                        ).map((s) => (
                          <div
                            key={s.key}
                            style={{ flexGrow: s.kwh, flexBasis: 0, background: s.color }}
                          />
                        ))}
                      </div>
                    ) : (
                      // A night that reported no energy still draws its track, and can be read.
                      <div
                        className="w-full rounded-[3px] bg-(--surface-3)"
                        style={{ height: 3 }}
                      />
                    )}
                  </button>
                ) : (
                  // A night with nothing reported: the slot stays, drawn as an empty track.
                  <div
                    className="flex h-10 w-full items-end"
                    role="img"
                    aria-label={`${day}: no parked energy reported`}
                  >
                    <div className="w-full rounded-[3px] bg-(--surface-3)" style={{ height: 3 }} />
                  </div>
                )}
                <span
                  aria-hidden
                  className={`text-[10px] leading-3 ${
                    night.key === newest ? 'text-(--text-primary)' : 'text-(--text-muted)'
                  }`}
                >
                  {night.date.toLocaleDateString([], { weekday: 'narrow' })}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
