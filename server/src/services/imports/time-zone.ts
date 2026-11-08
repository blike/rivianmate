const OFFSET_SLOT_MS = 15 * 60_000;

export interface LocalTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Local times to instants. An hour that clocks repeat is ambiguous, so a row
 * takes the first reading that isn't before the row ahead of it; rows are in
 * order, so this walks through the repeat as the export did.
 */
export class TimeZoneClock {
  private readonly format: Intl.DateTimeFormat;
  private previous = -Infinity;
  private readonly offsets = new Map<number, number[]>();

  constructor(timeZone: string) {
    this.format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  }

  /** The zone's offset from UTC at an instant (ms). */
  private offsetAt(at: number): number {
    const parts = Object.fromEntries(
      this.format.formatToParts(at).map((p) => [p.type, Number(p.value)]),
    ) as Record<string, number>;
    const wall = Date.UTC(
      parts['year']!,
      parts['month']! - 1,
      parts['day']!,
      parts['hour']!,
      parts['minute']!,
      parts['second']!,
    );
    return wall - Math.floor(at / 1000) * 1000;
  }

  /** The instant of a local time, keeping rows in order. */
  next(local: LocalTime): number {
    const at = this.candidates(local).find((t) => t >= this.previous) ?? this.first(local);
    this.previous = at;
    return at;
  }

  /** The instant of a local time, on its own (the earlier one if clocks repeat it). */
  first(local: LocalTime): number {
    return this.candidates(local)[0]!;
  }

  private candidates(local: LocalTime): number[] {
    const wall = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    return this.offsetsNear(wall).map((offset) => wall - offset);
  }

  /**
   * The offsets a local time can have. Read for every row of an export and
   * slow to work out, so kept per 15 minutes, the finest clocks change on.
   */
  private offsetsNear(wall: number): number[] {
    const slot = Math.floor(wall / OFFSET_SLOT_MS);
    const known = this.offsets.get(slot);
    if (known) return known;
    const before = this.offsetAt(wall - 86_400_000);
    const found = [...new Set([before, this.offsetAt(wall + 86_400_000)])]
      .filter((offset) => this.offsetAt(wall - offset) === offset)
      .sort((a, b) => b - a);
    // A time clocks skip doesn't exist; it reads as the offset before the skip.
    const offsets = found.length > 0 ? found : [before];
    this.offsets.set(slot, offsets);
    return offsets;
  }

  /** An instant's calendar date in this zone, as YYYY-MM-DD. */
  dateOf(at: number): string {
    const parts = Object.fromEntries(
      this.format.formatToParts(at).map((p) => [p.type, p.value]),
    ) as Record<string, string>;
    return `${parts['year']}-${parts['month']!.padStart(2, '0')}-${parts['day']!.padStart(2, '0')}`;
  }
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
