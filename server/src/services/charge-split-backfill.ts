import { and, asc, eq, gt, gte, inArray, isNotNull, lt, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  appSettings,
  chargingCurvePoints,
  chargingSessions,
  tripActivities,
  tripExclusions,
  trips as tripsTable,
  vehicles,
} from '../db/schema.js';
import type { Logger } from '../logger.js';
import {
  type ChargeBreakdown,
  RVM_CHARGE_BREAKDOWN,
  decodeChargeBreakdown,
} from '../rivian/parallax/domains/energy.js';
import {
  type ChargeRun,
  type ChargerReading,
  breakdownMatches,
  chargeRuns,
} from './charging-time.js';
import type { ParallaxArchive } from './parallax-archive.js';
import { stateTimeline } from './state-history.js';
import { stateNumber, stateString } from './state-utils.js';

/** `app_settings` key: `{"after":{"<vehicleId>":<session id>}}` while running, `{"done":true}` after. */
export const SPLIT_KEY = 'charge_split_backfill';
/**
 * `app_settings` key: each split as `{vehicleId, session, added}`, the
 * session row as it was and the ids split from it, so a split can be undone.
 */
export const SPLIT_LOG_KEY = 'charge_split_log';
/** How long after a charge stops its closing breakdown can still arrive. */
const LATE_BREAKDOWN_MS = 30 * 60_000;
const CHARGER_FIELDS = ['chargerStatus', 'chargerState', 'timeToEndOfCharge', 'batteryLevel'];

export interface ChargeSplitDeps {
  db: Db;
  archive: ParallaxArchive;
  log: Logger;
}

type Session = typeof chargingSessions.$inferSelect;

interface Totals {
  energyKwh: number | null;
  packKwh: number | null;
  thermalKwh: number | null;
  rangeAddedKm: number | null;
}

/** One charge of a split session, with what it gets of the session's figures. */
export interface SplitCharge extends Totals {
  run: ChargeRun;
  chargingSeconds: number;
  cost: string | null;
}

interface Progress {
  done?: boolean;
  after?: Record<string, number>;
}

async function readSetting<T>(db: Pick<Db, 'select'>, key: string, fallback: T): Promise<T> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key));
  try {
    return row ? (JSON.parse(row.value) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeSetting(db: Pick<Db, 'insert'>, key: string, data: unknown): Promise<void> {
  const value = JSON.stringify(data);
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

/**
 * Once per install, splits each session RivianMate recorded as one plug-in
 * into the charges it held, as sessions are now recorded: charging that
 * stopped for good and started again without unplugging is a second charge.
 * The charges come from the session's recorded charger state, by the same
 * rules the charging monitor uses (`chargeRuns`).
 *
 * The session keeps its first charge, so its id, trips and Rivian link stay;
 * each later charge is a new session in the same trips. Energy comes from
 * each charge's archived breakdowns; without them, the session's figures are
 * shared by battery gained. Cost, entered by the owner or billed by Rivian,
 * is shared by energy. Imported sessions have no charger state to split by
 * and are left as they are. Resumes per vehicle after a restart.
 */
export async function splitPluginCharges(
  deps: ChargeSplitDeps,
  until: Date,
): Promise<{ sessions: number; added: number } | null> {
  const { db, log } = deps;
  const progress = await readSetting<Progress>(db, SPLIT_KEY, {});
  if (progress.done) return null;
  const after = { ...progress.after };
  let sessions = 0;
  let added = 0;

  for (const { id: vehicleId } of await db.select({ id: vehicles.id }).from(vehicles)) {
    const candidates = await db
      .select()
      .from(chargingSessions)
      .where(
        and(
          eq(chargingSessions.vehicleId, vehicleId),
          gt(chargingSessions.id, after[vehicleId] ?? 0),
          inArray(chargingSessions.source, ['live', 'live+rivian']),
          isNotNull(chargingSessions.endedAt),
          lt(chargingSessions.endedAt, until),
          gt(chargingSessions.chargingSeconds, 0),
        ),
      )
      .orderBy(asc(chargingSessions.id));

    for (const session of candidates) {
      const charges = await planSplit(deps, session);
      if (charges) {
        log.info(
          {
            vehicleId,
            sessionId: session.id,
            charges: charges.map((c) => ({
              from: new Date(c.run.from).toISOString(),
              to: new Date(c.run.to).toISOString(),
              energyKwh: c.energyKwh,
              cost: c.cost,
            })),
          },
          'splitting charging session',
        );
        sessions += 1;
        added += charges.length - 1;
      }
      after[vehicleId] = session.id;
      await db.transaction(async (tx) => {
        if (charges) {
          const ids = await applySplit(tx as unknown as Db, session, charges);
          const splits = await readSetting<unknown[]>(tx, SPLIT_LOG_KEY, []);
          // The raw push payload stays on the session and isn't needed to undo it.
          const { rawFinal: _raw, ...before } = session;
          splits.push({ vehicleId, session: before, added: ids });
          await writeSetting(tx, SPLIT_LOG_KEY, splits);
        }
        await writeSetting(tx, SPLIT_KEY, { after });
      });
    }
  }

  await writeSetting(db, SPLIT_KEY, { done: true });
  if (sessions) log.info(`split ${sessions} charging sessions into ${sessions + added} charges`);
  return { sessions, added };
}

/** The charges a session held and what each gets of it, or null when it held one. */
async function planSplit(deps: ChargeSplitDeps, session: Session): Promise<SplitCharge[] | null> {
  const from = session.startedAt;
  const to = session.endedAt!;
  const timeline = await stateTimeline(deps.db, session.vehicleId, CHARGER_FIELDS, from, to, {
    liveOnly: true,
  });
  const readings: ChargerReading[] = timeline.map(({ at, state }) => {
    const status = stateString(state, 'chargerStatus');
    return {
      at,
      plugged: status == null ? null : status !== 'chrgr_sts_not_connected',
      chargerState: stateString(state, 'chargerState'),
      minutesLeft: stateNumber(state, 'timeToEndOfCharge'),
      soc: stateNumber(state, 'batteryLevel'),
    };
  });
  const runs = chargeRuns(readings, to.getTime());
  if (runs.length < 2) return null;

  const messages = await deps.archive.messages(
    session.vehicleId,
    RVM_CHARGE_BREAKDOWN,
    from,
    new Date(to.getTime() + LATE_BREAKDOWN_MS),
  );
  const breakdowns = messages.flatMap((m) => {
    const b = decodeChargeBreakdown(m.payload);
    return b && b.totalKwh > 0 ? [{ at: m.at.getTime(), b }] : [];
  });
  return shareSession(session, runs, breakdowns);
}

/**
 * What each charge gets of a session: its own breakdown totals when every
 * charge has them, or else the session's totals shared by battery gained
 * (by charging time without it). Cost is shared by energy, to the cent.
 */
export function shareSession(
  session: Pick<Session, 'energyKwh' | 'packKwh' | 'thermalKwh' | 'rangeAddedKm' | 'cost'>,
  runs: readonly ChargeRun[],
  breakdowns: readonly { at: number; b: ChargeBreakdown }[],
): SplitCharge[] {
  const seconds = runs.map((r) =>
    Math.round(r.stretches.reduce((sum, s) => sum + (s.to - s.from), 0) / 1000),
  );
  const own = runs.map((r) => runTotals(r, breakdowns));
  let totals: Totals[];
  if (own.every((t): t is Totals => t !== null)) {
    totals = own;
  } else {
    const gained = runs.map((r) =>
      r.startSoc != null && r.endSoc != null ? Math.max(0, r.endSoc - r.startSoc) : null,
    );
    const byGain = gained.every((g) => g !== null) && gained.reduce((a, g) => a + g!, 0) > 0;
    const weights = byGain ? (gained as number[]) : seconds;
    const sum = weights.reduce((a, w) => a + w, 0);
    const part = (value: number | null, i: number) =>
      value == null ? null : sum > 0 ? (value * weights[i]!) / sum : i === 0 ? value : 0;
    totals = runs.map((_, i) => ({
      energyKwh: part(session.energyKwh, i),
      packKwh: part(session.packKwh, i),
      thermalKwh: part(session.thermalKwh, i),
      rangeAddedKm: part(session.rangeAddedKm, i),
    }));
  }

  const costs = shareCost(
    session.cost,
    totals.map((t) => t.energyKwh),
    seconds,
  );
  return runs.map((run, i) => ({
    run,
    chargingSeconds: seconds[i]!,
    ...totals[i]!,
    cost: costs[i]!,
  }));
}

/** A charge's totals from its breakdowns: each stretch's last word, added up; null when a stretch has none. */
function runTotals(
  run: ChargeRun,
  breakdowns: readonly { at: number; b: ChargeBreakdown }[],
): Totals | null {
  const sum: Totals = { energyKwh: 0, packKwh: 0, thermalKwh: 0, rangeAddedKm: 0 };
  let range = false;
  for (const stretch of run.stretches) {
    // Rivian's counter restarts with each stretch, so its last message that
    // fits the stretch's own charging time is the stretch's total.
    const fits = breakdowns.filter(
      ({ at, b }) =>
        at >= stretch.from &&
        at <= stretch.to + LATE_BREAKDOWN_MS &&
        breakdownMatches(b.chargingMinutes, (Math.min(at, stretch.to) - stretch.from) / 1000),
    );
    const last = fits.at(-1)?.b;
    if (!last) return null;
    sum.energyKwh! += last.totalKwh;
    sum.packKwh! += last.packKwh;
    sum.thermalKwh! += last.thermalKwh;
    if (last.rangeAddedKm != null) {
      sum.rangeAddedKm! += last.rangeAddedKm;
      range = true;
    }
  }
  return range ? sum : { ...sum, rangeAddedKm: null };
}

/** A cost shared by energy (by charging time without it), to the cent, adding up to the whole. */
function shareCost(
  cost: string | null,
  energy: readonly (number | null)[],
  seconds: readonly number[],
): (string | null)[] {
  if (cost == null) return energy.map(() => null);
  const cents = Math.round(Number(cost) * 100);
  const byEnergy = energy.every((e) => e != null) && energy.reduce((a, e) => a + e!, 0) > 0;
  const weights = byEnergy ? (energy as number[]) : seconds;
  const sum = weights.reduce((a, w) => a + w, 0);
  const shares = weights.map((w) => (sum > 0 ? Math.floor((cents * w) / sum) : 0));
  // Whatever rounding left goes to the first charge, so the parts add up.
  shares[0]! += cents - shares.reduce((a, c) => a + c, 0);
  return shares.map((c) => (c / 100).toFixed(2));
}

/** Writes a split: the session becomes its first charge and each later one a new session. Returns their ids. */
async function applySplit(db: Db, session: Session, charges: SplitCharge[]): Promise<number[]> {
  const figures = (c: SplitCharge) => ({
    startedAt: new Date(c.run.from),
    endedAt: new Date(c.run.to),
    chargingSeconds: c.chargingSeconds,
    chargingSince: null,
    startSoc: c.run.startSoc,
    endSoc: c.run.endSoc,
    energyKwh: c.energyKwh,
    packKwh: c.packKwh,
    thermalKwh: c.thermalKwh,
    rangeAddedKm: c.rangeAddedKm,
    cost: c.cost,
  });

  const [first, ...rest] = charges;
  await db.update(chargingSessions).set(figures(first!)).where(eq(chargingSessions.id, session.id));
  const {
    id: _id,
    rivianTransactionId: _tx,
    rawFinal: _raw,
    avgPowerKw: _avg,
    maxPowerKw: _max,
    ...shared
  } = session;
  const ids: number[] = [];
  for (const charge of rest) {
    const [row] = await db
      .insert(chargingSessions)
      .values({ ...shared, ...figures(charge) })
      .returning({ id: chargingSessions.id });
    ids.push(row!.id);
  }

  // Each curve point goes to the charge it falls in, a gap to the charge before it.
  for (let i = rest.length - 1; i >= 0; i--) {
    await db
      .update(chargingCurvePoints)
      .set({ sessionId: ids[i]! })
      .where(
        and(
          eq(chargingCurvePoints.sessionId, session.id),
          gte(chargingCurvePoints.ts, new Date(rest[i]!.run.from)),
        ),
      );
  }
  const all = [session.id, ...ids];
  const points = await db
    .select({ sessionId: chargingCurvePoints.sessionId, powerKw: chargingCurvePoints.powerKw })
    .from(chargingCurvePoints)
    .where(
      and(
        inArray(chargingCurvePoints.sessionId, all),
        ne(chargingCurvePoints.source, 'forecast'),
        isNotNull(chargingCurvePoints.powerKw),
      ),
    );
  if (points.length > 0) {
    for (const id of all) {
      const power = points.filter((p) => p.sessionId === id).map((p) => p.powerKw!);
      await db
        .update(chargingSessions)
        .set({
          avgPowerKw: power.length ? power.reduce((a, p) => a + p, 0) / power.length : null,
          maxPowerKw: power.length ? Math.max(...power) : null,
        })
        .where(eq(chargingSessions.id, id));
    }
  }

  // The new charges join the trips the session was in, or stay out of those it was taken out of.
  const trips = await db
    .select({ tripId: tripActivities.tripId })
    .from(tripActivities)
    .where(
      and(
        eq(tripActivities.vehicleId, session.vehicleId),
        eq(tripActivities.kind, 'charge'),
        eq(tripActivities.activityId, session.id),
      ),
    );
  const excluded = await db
    .select({ tripId: tripExclusions.tripId })
    .from(tripExclusions)
    .where(
      and(
        eq(tripExclusions.kind, 'charge'),
        eq(tripExclusions.activityId, session.id),
        // Exclusions carry no vehicle: only this vehicle's trips are its own.
        inArray(
          tripExclusions.tripId,
          db
            .select({ id: tripsTable.id })
            .from(tripsTable)
            .where(eq(tripsTable.vehicleId, session.vehicleId)),
        ),
      ),
    );
  for (const id of ids) {
    if (trips.length) {
      await db.insert(tripActivities).values(
        trips.map((t) => ({
          tripId: t.tripId,
          vehicleId: session.vehicleId,
          kind: 'charge' as const,
          activityId: id,
        })),
      );
    }
    if (excluded.length) {
      await db
        .insert(tripExclusions)
        .values(
          excluded.map((t) => ({ tripId: t.tripId, kind: 'charge' as const, activityId: id })),
        );
    }
  }
  return ids;
}
