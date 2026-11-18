import type { ParkedDayDto } from '@server/api-types';
import { parkedSegments, parkedUnsplit, type ParkedDay } from '../lib/insights';
import { fmt } from '../lib/state';
import { BarReadout, useBarReadout, type BarReading } from './BarReadout';

/** The day under a bar, in the device's own calendar: "Wed, Oct 8". */
function dayLabel(day: Date): string {
  return day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * The window a day's bar covers, in words: "24 h to 9:14 PM". The 24 hours end
 * at that day's last reading, not at midnight, so the reading says when.
 */
function windowPhrase(reading: ParkedDayDto): string {
  const length =
    reading.minutes % 60 === 0 ? `${reading.minutes / 60} h` : `${reading.minutes} min`;
  const end = new Date(reading.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${length} to ${end}`;
}

/** A reading's uses in words, for the bars' labels: "System 1.6 kWh, Climate 0.4 kWh". */
function usesText(reading: ParkedDayDto): string {
  const segments = parkedSegments(reading.uses);
  return segments.map((s) => `${s.label} ${fmt(s.kwh, 1)} kWh`).join(', ') || 'no use drew energy';
}

/** A day's reading, as its readout prints it: the day, its window, total and uses. */
function readingOf(day: ParkedDay<ParkedDayDto>, w: ParkedDayDto): BarReading {
  return {
    heading: `${dayLabel(day.date)} · ${windowPhrase(w)}`,
    total: w.kwh,
    uses: parkedSegments(w.uses),
    unsplit: parkedUnsplit(w.uses),
  };
}

/**
 * Parked energy as one bar per day across the last full week, split into the
 * same uses as the window bars above it, so a week's pattern reads at a
 * glance. Each bar is the last 24 hours Rivian reported that day: the day and
 * the night before it. A day with no reading keeps an empty slot rather than
 * closing the gap. The totals sit above the bars so the shape is read against
 * a number, and a bar's own numbers are read by pointing at it, tapping it or
 * tabbing to it: a small day is a sliver three pixels wide.
 */
export function ParkedWeek(props: { days: ParkedDay<ParkedDayDto>[] }) {
  const days = props.days;
  const readout = useBarReadout<ParkedDay<ParkedDayDto>>();
  if (days.length === 0) return null;
  const reported = days.flatMap((day) => (day.window ? [day.window] : []));
  const total = reported.reduce((sum, w) => sum + w.kwh, 0);
  const most = Math.max(0, ...reported.map((w) => w.kwh));
  const newest = days.at(-1)?.key;
  const open = readout.open;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-4 text-sm">
        <span className="text-(--text-secondary)">Last {days.length} days</span>
        <span className="tabular-nums">
          {fmt(total, 1)} kWh over {reported.length} {reported.length === 1 ? 'day' : 'days'}
        </span>
      </div>
      <div className="relative" {...readout.groupProps}>
        {open?.window && <BarReadout reading={readingOf(open, open.window)} />}
        <div className="flex items-end gap-2">
          {days.map((day) => {
            const w = day.window;
            const segments = w ? parkedSegments(w.uses) : [];
            const label = dayLabel(day.date);
            return (
              <div
                key={day.key}
                data-day={day.key}
                className="flex min-w-0 flex-1 flex-col items-center gap-1"
              >
                {w ? (
                  <button
                    type="button"
                    className="bar-readout__trigger flex h-10 w-full items-end"
                    aria-label={`${label}: ${fmt(w.kwh, 1)} kWh used while parked over ${windowPhrase(
                      w,
                    )}, ${usesText(w)}`}
                    {...readout.barProps(day)}
                  >
                    {w.kwh > 0 && segments.length > 0 ? (
                      <div
                        className="flex w-full flex-col-reverse overflow-hidden rounded-t-[4px]"
                        style={{ height: `max(3px, ${(w.kwh / most) * 100}%)` }}
                      >
                        {segments.map((s) => (
                          <div
                            key={s.key}
                            style={{ flexGrow: s.kwh, flexBasis: 0, background: s.color }}
                          />
                        ))}
                      </div>
                    ) : (
                      // A day that reported no energy still draws its track, and can be read.
                      <div
                        className="w-full rounded-[3px] bg-(--surface-3)"
                        style={{ height: 3 }}
                      />
                    )}
                  </button>
                ) : (
                  // A day with nothing reported: the slot stays, drawn as an empty track.
                  <div
                    className="flex h-10 w-full items-end"
                    role="img"
                    aria-label={`${label}: no parked energy reported`}
                  >
                    <div className="w-full rounded-[3px] bg-(--surface-3)" style={{ height: 3 }} />
                  </div>
                )}
                <span
                  aria-hidden
                  className={`text-[10px] leading-3 ${
                    day.key === newest ? 'text-(--text-primary)' : 'text-(--text-muted)'
                  }`}
                >
                  {day.date.toLocaleDateString([], { weekday: 'narrow' })}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
