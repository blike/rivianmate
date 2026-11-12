import { desc, eq } from 'drizzle-orm';
import type { ParkedNightDto } from '../api-types.js';
import type { Db } from '../db/client.js';
import { parkedEnergyNights } from '../db/schema.js';
import { type Logger, silentLogger } from '../logger.js';
import type { ParkedEnergyWindow } from '../rivian/parallax/index.js';
import { isTimeZone } from './imports/time-zone.js';

/** The window a night is recorded from: Rivian's rolling day. */
const DAY_MINUTES = 24 * 60;

/**
 * The window a night's numbers come from: the shortest of those at least a
 * day long, so the rolling 24 hours beats a park that has run for days, and
 * a payload carrying only shorter windows records nothing rather than
 * understating a night with its last 8 hours.
 */
export function dayWindow(windows: readonly ParkedEnergyWindow[]): ParkedEnergyWindow | null {
  return windows.reduce<ParkedEnergyWindow | null>(
    (kept, w) => (w.minutes >= DAY_MINUTES && (!kept || w.minutes < kept.minutes) ? w : kept),
    null,
  );
}

/**
 * The night a report belongs to, as YYYY-MM-DD in `zone`: the day it ends on,
 * a millisecond's grace so an end at local midnight closes the night that has
 * just run — the same rule the chart lays its nights out by.
 */
export function nightOf(at: Date, zone: string): string {
  // en-CA formats as YYYY-MM-DD; the calendar does the rest, DST included.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at.getTime() - 1));
}

/**
 * One row per vehicle per night of parked energy, written off the payloads
 * that arrive anyway: no Rivian request, no wake. A day's row is written the
 * first time a payload lands after its midnight and never again, so a week
 * fills in as nights pass, and a night RivianMate was off for keeps a gap.
 *
 * The night is a date of the calendar the chart draws days in, which is the
 * browser's: it says so when it asks for the nights (the phantom-drain rule).
 * Until one has, the server's own zone stands in, and every row also keeps
 * Rivian's instant, so the chart can place a night by the reader's calendar
 * whatever the writer thought the day was.
 */
export class ParkedEnergyNights {
  /** The reader's calendar, once a browser has said which one it draws in. */
  private zone: string | null = null;
  /** The last night written per vehicle; seeded from the table on first use. */
  private readonly lastNight = new Map<string, string>();

  constructor(
    private readonly db: Db,
    private readonly log: Logger = silentLogger,
    private readonly serverZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  ) {}

  /** The zone days are recorded in: the browser's, once it has said. */
  setZone(zone: string | undefined): void {
    if (zone && isTimeZone(zone)) this.zone = zone;
  }

  /** Keeps a night of parked energy: the 24-hour window, once per vehicle per day. */
  async record(vehicleId: string, windows: readonly ParkedEnergyWindow[], at: Date): Promise<void> {
    const window = dayWindow(windows);
    if (!window) return;
    const day = nightOf(at, this.zone ?? this.serverZone);
    try {
      if (day === (await this.lastDay(vehicleId))) return;
      await this.db
        .insert(parkedEnergyNights)
        .values({
          vehicleId,
          day,
          at,
          minutes: window.minutes,
          kwh: window.kwh,
          rangeKm: window.rangeKm,
          climateKwh: window.uses.climate,
          systemKwh: window.uses.system,
          gearGuardKwh: window.uses.gearGuard,
          outletsKwh: window.uses.outlets,
        })
        // A restarted process reads the table again; this covers the race.
        .onConflictDoNothing();
      this.lastNight.set(vehicleId, day);
    } catch (err) {
      this.log.error({ err, vehicleId, day }, 'recording the night’s parked energy failed');
    }
  }

  /** The last `nights` recorded, oldest first, as the chart reads them. */
  async recent(vehicleId: string, nights: number): Promise<ParkedNightDto[]> {
    const rows = await this.db
      .select()
      .from(parkedEnergyNights)
      .where(eq(parkedEnergyNights.vehicleId, vehicleId))
      .orderBy(desc(parkedEnergyNights.day))
      .limit(nights);
    return rows.reverse().map((row) => ({
      at: row.at.toISOString(),
      minutes: row.minutes,
      kwh: row.kwh,
      rangeKm: row.rangeKm,
      uses: {
        climate: row.climateKwh,
        system: row.systemKwh,
        gearGuard: row.gearGuardKwh,
        outlets: row.outletsKwh,
      },
    }));
  }

  /** The last night written for a vehicle, read once per process. */
  private async lastDay(vehicleId: string): Promise<string | null> {
    const known = this.lastNight.get(vehicleId);
    if (known) return known;
    const [row] = await this.db
      .select({ day: parkedEnergyNights.day })
      .from(parkedEnergyNights)
      .where(eq(parkedEnergyNights.vehicleId, vehicleId))
      .orderBy(desc(parkedEnergyNights.day))
      .limit(1);
    return row?.day ?? null;
  }
}
