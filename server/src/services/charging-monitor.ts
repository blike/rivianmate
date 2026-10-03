import { and, desc, eq, gte, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  chargingCurvePoints,
  chargingSessions,
  wallboxReadings,
  wallboxes,
} from "../db/schema.js";
import type { RivianApi } from "../rivian/client.js";
import {
  type ChargeBreakdown,
  type ChargingGraphBar,
  type ParallaxMessage,
  RVM_BATTERY_STATE,
  RVM_CHARGE_BREAKDOWN,
  RVM_CHARGING_STATUS,
  RVM_CHARGING_GRAPH,
  RVM_SOC_SLIDER,
  RVM_TIME_ESTIMATION,
  decodeBatteryState,
  decodeChargeBreakdown,
  decodeChargingGraph,
  decodeChargingStatus,
  chargerStateFromStatus,
  decodeSocSlider,
  decodeTimeEstimation,
} from "../rivian/parallax.js";
import {
  LiveSessionData,
  RivianRateLimitError,
  RivianUnauthenticatedError,
  type VehicleState,
} from "../rivian/types.js";
import { isChargingState, stampedAt } from "./charging-time.js";
import { LiveChargeState, type LiveSource } from "./live-charging.js";
import { nearbySpot } from "./home-charging.js";
import type { LiveBus } from "./live-bus.js";
import { type ResumableSession, closeTime } from "./session-resume.js";
import { stateNumber, stateString } from "./state-utils.js";

/** Wallbox readings are only interesting while a vehicle is plugged in. */
const WALLBOX_INTERVAL_MS = 15 * 60_000;
/**
 * Graph bars may predate the session's recorded start (we can start
 * watching mid plug-in). How far back the graph reaches is unconfirmed, so
 * older bars are dropped rather than risk attaching a previous session's.
 */
const GRAPH_LOOKBACK_MS = 12 * 3600_000;
/** Tolerance at a finished session's edges: a graph bar starts on Rivian's clock. */
const GRAPH_SLACK_MS = 10 * 60_000;
/**
 * Rivian's charging graph carries the charge so far and, after it, the
 * vehicle's forecast to the limit (SoC without power). A bar starting more
 * than this after the message was sent is forecast, not a reading.
 */
const GRAPH_CLOCK_SLACK_MS = 60_000;
/**
 * A breakdown carries no session id or time, only minutes spent charging,
 * so it goes to the session whose charging time matches. Rivian resends the
 * previous session's breakdown on subscribe, which this keeps off a new one.
 */
const BREAKDOWN_MATCH_MIN_S = 5 * 60;
const BREAKDOWN_MATCH_FRACTION = 0.1;
/** How far apart a power reading and the SoC paired with it may be. */
const LIVE_SOC_MAX_GAP_MS = 5 * 60_000;
/** Finished sessions older than this don't take a breakdown. */
const BREAKDOWN_MAX_AGE_MS = 7 * 86_400_000;

interface OpenSession {
  id: number;
  startedAt: number;
  powerSum: number;
  powerCount: number;
  maxPowerKw: number;
  /** Seconds charged in finished stretches; the running one is `chargingSince`. */
  chargingSeconds: number;
  chargingSince: number | null;
}

/** What vehicle state says about charging, timed by Rivian's stamps. */
interface PlugReading {
  plugged: boolean;
  /** When the plug state was stamped (the unplug time on an unplug delta). */
  pluggedAt: number;
  charging: boolean;
  chargingAt: number;
  soc: number | null;
}

/**
 * Records one charging session per plug-in, as Rivian's history does:
 * plugging in opens it and unplugging closes it, so pauses (a scheduled
 * charge waiting for its window, a top-up after completing) stay in one
 * row. Vehicle state supplies the plug state, time spent charging and SOC.
 * The power curve comes from Parallax's charging graph; the legacy
 * `chargingSession` push feed, when Rivian sends it, adds energy and cost.
 *
 * Nothing here polls Rivian while the vehicle is unplugged; while plugged
 * in, only wallbox readings are refreshed.
 */
export class ChargingMonitor {
  private timer?: NodeJS.Timeout;
  private running = false;
  private pluggedIn = new Set<string>();
  /** Vehicles whose plug state we've seen; until then the push feed decides. */
  private plugKnown = new Set<string>();
  private lastWallboxPollAt = 0;
  private openSessions = new Map<string, OpenSession>();
  /** Sessions a previous run left open, awaiting proof they're still going. */
  private resumable = new Map<string, ResumableSession>();
  private lastWallboxReading = new Map<string, string>();
  /** Per-vehicle serialization so pushes and polls never race an insert. */
  private chains = new Map<string, Promise<void>>();
  /** Rivian vehicle ids (from getUserInfo, not VINs). */
  private vehicles = new Set<string>();
  private latestLocation = new Map<string, { lat: number; lon: number }>();
  /** Live readings from every source, merged field by field. */
  private live = new Map<string, LiveChargeState>();
  /** What was last emitted per vehicle, so repeats aren't re-sent. */
  private liveSent = new Map<string, string>();

  /** Rivian rejected credentials even after a session rotation. */
  onAuthFailure?: () => void;
  /** A REST call succeeded with the current credentials. */
  onAuthOk?: () => void;
  /** A recorded session just ended (e.g. to sync Rivian's history). */
  onSessionEnded?: (vehicleId: string) => void;

  constructor(
    private readonly db: Db,
    private readonly api: RivianApi,
    private readonly bus: LiveBus,
    private readonly log: (msg: string) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  setVehicles(vehicleIds: string[]): void {
    this.vehicles = new Set(vehicleIds);
  }

  noteLocation(vehicleId: string, lat: number, lon: number): void {
    this.latestLocation.set(vehicleId, { lat, lon });
  }

  /**
   * Vehicle state from the monitor: plug state, charger state and battery
   * level. Ignored until the plug state is known.
   */
  noteState(vehicleId: string, state: VehicleState): void {
    const status = stateString(state, "chargerStatus");
    if (status === null) return;
    const now = this.now();
    const soc = stateNumber(state, "batteryLevel");
    const chargerState = stateString(state, "chargerState");
    const minutesLeft = stateNumber(state, "timeToEndOfCharge");
    this.observe(vehicleId, "state", stampedAt(state, "chargerState", now), [
      ["chargerState", chargerState],
      ["soc", soc],
    ]);
    if (minutesLeft != null) {
      this.observe(vehicleId, "state", stampedAt(state, "timeToEndOfCharge", now), [["secondsLeft", minutesLeft * 60]]);
    }
    this.applyPlugReading(vehicleId, {
      plugged: status !== "chrgr_sts_not_connected",
      pluggedAt: stampedAt(state, "chargerStatus", now),
      charging: isChargingState(stateString(state, "chargerState")),
      chargingAt: stampedAt(state, "chargerState", now),
      soc: stateNumber(state, "batteryLevel"),
    });
  }

  /** Plug state alone (no charger state or SOC). */
  setPluggedIn(vehicleId: string, pluggedIn: boolean): void {
    const now = this.now();
    this.applyPlugReading(vehicleId, {
      plugged: pluggedIn,
      pluggedAt: now,
      charging: false,
      chargingAt: now,
      soc: null,
    });
  }

  private applyPlugReading(vehicleId: string, reading: PlugReading): void {
    this.plugKnown.add(vehicleId);
    const wasPlugged = this.pluggedIn.has(vehicleId);
    if (reading.plugged) this.pluggedIn.add(vehicleId);
    else this.pluggedIn.delete(vehicleId);
    void this.enqueue(vehicleId, () => this.processPlugReading(vehicleId, reading));
    if (wasPlugged !== reading.plugged) this.reschedule();
  }

  /**
   * Parallax messages. The charging graph becomes the session's power curve;
   * the charge breakdown splits its energy into pack and heating/cooling.
   * Rivian keeps the last session's graph after it ends and sends it on
   * subscribe, so bars go to the open session, or else to the finished
   * session they fall within.
   */
  ingestParallax(vehicleId: string, message: ParallaxMessage): Promise<void> {
    const at = parallaxTime(message.timestamp) ?? this.now();
    if (message.rvm === RVM_TIME_ESTIMATION) {
      // Empty once charging stops; null then means no estimate.
      const minutes = decodeTimeEstimation(message.payload)?.minutesRemaining || null;
      this.observe(vehicleId, "parallax", at, [["secondsLeft", minutes == null ? null : minutes * 60]]);
      return Promise.resolve();
    }
    if (message.rvm === RVM_BATTERY_STATE) {
      const battery = decodeBatteryState(message.payload);
      if (battery?.soc != null) {
        this.observe(vehicleId, "parallax", at, [
          ["soc", battery.soc],
          ...(battery.capacityKwh != null ? [["capacityKwh", battery.capacityKwh] as const] : []),
        ]);
      }
      return Promise.resolve();
    }
    if (message.rvm === RVM_CHARGING_STATUS) {
      const status = decodeChargingStatus(message.payload);
      const state = status && chargerStateFromStatus(status);
      if (state) this.observe(vehicleId, "parallax", at, [["chargerState", state]]);
      return Promise.resolve();
    }
    if (message.rvm === RVM_SOC_SLIDER) {
      const slider = decodeSocSlider(message.payload);
      if (slider) this.observe(vehicleId, "parallax", at, [["socLimit", slider.limit]]);
      return Promise.resolve();
    }
    if (message.rvm === RVM_CHARGE_BREAKDOWN) {
      const breakdown = decodeChargeBreakdown(message.payload);
      if (!breakdown || breakdown.totalKwh <= 0) return Promise.resolve();
      return this.enqueue(vehicleId, () => this.applyBreakdown(vehicleId, breakdown, at));
    }
    if (message.rvm !== RVM_CHARGING_GRAPH) return Promise.resolve();
    const bars = decodeChargingGraph(message.payload);
    if (bars.length === 0) return Promise.resolve();
    const sentAt = graphSentAt(message.timestamp, bars[0]!.startMs, this.now());
    const recorded = bars.filter((b) => b.startMs <= sentAt + GRAPH_CLOCK_SLACK_MS);
    const forecast = bars.filter((b) => b.startMs > sentAt + GRAPH_CLOCK_SLACK_MS);
    return this.enqueue(vehicleId, async () => {
      const target = await this.graphTarget(vehicleId, bars[0]!.startMs, bars.at(-1)!.startMs);
      if (!target) return;
      const open = target.id === this.openSessions.get(vehicleId)?.id;
      // The forecast belongs to a charge in progress, and each message
      // replaces the last one's.
      if (open) await this.replaceForecast(target.id, forecast);
      const inWindow = recorded.filter((b) => b.startMs >= target.from && b.startMs <= target.to);
      const rows = inWindow
        .filter((b) => b.powerKw != null || b.soc != null)
        .map((b) => ({ sessionId: target.id, source: "graph" as const, ts: new Date(b.startMs), powerKw: b.powerKw, soc: b.soc }));
      if (rows.length === 0) return;
      // The latest bar that carries power, timed by its end (or its start
      // while it's still running). The breakdown's live power is fresher.
      const latest = inWindow.filter((b) => b.powerKw != null).at(-1);
      if (latest && open) {
        this.observe(vehicleId, "parallax", latest.endMs ?? latest.startMs, [["powerKw", latest.powerKw]]);
      }
      await this.db
        .insert(chargingCurvePoints)
        .values(rows)
        .onConflictDoUpdate({
          target: [chargingCurvePoints.sessionId, chargingCurvePoints.source, chargingCurvePoints.ts],
          set: {
            powerKw: sql`COALESCE(excluded.power_kw, ${chargingCurvePoints.powerKw})`,
            soc: sql`COALESCE(excluded.soc, ${chargingCurvePoints.soc})`,
          },
        });
      await this.db
        .update(chargingSessions)
        .set({
          maxPowerKw: sql`(SELECT MAX(power_kw) FROM charging_curve_points WHERE session_id = ${target.id} AND source = 'graph')`,
          avgPowerKw: sql`(SELECT AVG(power_kw) FROM charging_curve_points WHERE session_id = ${target.id} AND source = 'graph' AND power_kw > 0)`,
        })
        .where(eq(chargingSessions.id, target.id));
    });
  }

  /** Swaps a charge's stored forecast for the latest one (none clears it). */
  private async replaceForecast(sessionId: number, bars: readonly ChargingGraphBar[]): Promise<void> {
    await this.db
      .delete(chargingCurvePoints)
      .where(and(eq(chargingCurvePoints.sessionId, sessionId), eq(chargingCurvePoints.source, "forecast")));
    const rows = bars
      .filter((b) => b.soc != null)
      .map((b) => ({ sessionId, source: "forecast" as const, ts: new Date(b.startMs), powerKw: b.powerKw, soc: b.soc }));
    if (rows.length > 0) await this.db.insert(chargingCurvePoints).values(rows).onConflictDoNothing();
  }

  private async applyBreakdown(vehicleId: string, b: ChargeBreakdown, at: number): Promise<void> {
    const matches = (chargingSeconds: number) =>
      Math.abs(b.chargingMinutes * 60 - chargingSeconds) <=
      Math.max(BREAKDOWN_MATCH_MIN_S, chargingSeconds * BREAKDOWN_MATCH_FRACTION);
    const split = { packKwh: b.packKwh, thermalKwh: b.thermalKwh };

    const open = this.openSessions.get(vehicleId);
    if (open) {
      const running = open.chargingSince !== null ? (this.now() - open.chargingSince) / 1000 : 0;
      if (!matches(open.chargingSeconds + running)) return;
      // Rivian's running totals for the session in progress.
      await this.db
        .update(chargingSessions)
        .set({
          ...split,
          energyKwh: b.totalKwh,
          ...(b.rangeAddedKm != null ? { rangeAddedKm: b.rangeAddedKm } : {}),
          ...(b.cost
            ? {
                cost: sql`COALESCE(${chargingSessions.cost}, ${b.cost.amount.toFixed(2)})`,
                currency: sql`COALESCE(${chargingSessions.currency}, ${b.cost.currency})`,
              }
            : {}),
        })
        .where(eq(chargingSessions.id, open.id));
      // Live readings only mean something while charging; otherwise they're
      // the last ones. Readings the message doesn't carry stay unknown.
      const charging = this.liveState(vehicleId).isCharging(this.now());
      this.observe(vehicleId, "parallax", at, [
        ["energyKwh", b.totalKwh],
        ...(b.rangeAddedKm != null ? [["rangeAddedKm", b.rangeAddedKm] as const] : []),
        ...(charging && b.powerKw != null ? [["powerKw", b.powerKw] as const] : []),
        ...(charging && b.rangeKmPerHour != null ? [["rangeKmPerHour", b.rangeKmPerHour] as const] : []),
      ]);
      return;
    }

    const [last] = await this.db
      .select({ id: chargingSessions.id, chargingSeconds: chargingSessions.chargingSeconds })
      .from(chargingSessions)
      .where(
        and(
          eq(chargingSessions.vehicleId, vehicleId),
          isNotNull(chargingSessions.endedAt),
          gte(chargingSessions.endedAt, new Date(this.now() - BREAKDOWN_MAX_AGE_MS)),
        ),
      )
      .orderBy(desc(chargingSessions.startedAt))
      .limit(1);
    if (!last || last.chargingSeconds == null || !matches(last.chargingSeconds)) return;
    // A finished session keeps the energy it has (e.g. from Rivian's history).
    await this.db
      .update(chargingSessions)
      .set({
        ...split,
        energyKwh: sql`COALESCE(${chargingSessions.energyKwh}, ${b.totalKwh})`,
        rangeAddedKm: sql`COALESCE(${chargingSessions.rangeAddedKm}, ${b.rangeAddedKm})`,
      })
      .where(eq(chargingSessions.id, last.id));
  }

  /** The session a graph spanning [firstMs, lastMs] belongs to, and its time window. */
  private async graphTarget(
    vehicleId: string,
    firstMs: number,
    lastMs: number,
  ): Promise<{ id: number; from: number; to: number } | null> {
    const open = this.openSessions.get(vehicleId);
    if (open) {
      return { id: open.id, from: open.startedAt - GRAPH_LOOKBACK_MS, to: this.now() + GRAPH_CLOCK_SLACK_MS };
    }
    const [closed] = await this.db
      .select({ id: chargingSessions.id, startedAt: chargingSessions.startedAt, endedAt: chargingSessions.endedAt })
      .from(chargingSessions)
      .where(
        and(
          eq(chargingSessions.vehicleId, vehicleId),
          isNotNull(chargingSessions.endedAt),
          lte(chargingSessions.startedAt, new Date(lastMs + GRAPH_SLACK_MS)),
          gte(chargingSessions.endedAt, new Date(firstMs - GRAPH_SLACK_MS)),
        ),
      )
      .orderBy(desc(chargingSessions.startedAt))
      .limit(1);
    if (!closed) return null;
    return {
      id: closed.id,
      from: closed.startedAt.getTime() - GRAPH_SLACK_MS,
      to: closed.endedAt!.getTime() + GRAPH_SLACK_MS,
    };
  }

  /** Live session data pushed over the WebSocket. */
  ingest(vehicleId: string, session: LiveSessionData | null): Promise<void> {
    return this.enqueue(vehicleId, async () => {
      await this.processSession(vehicleId, session);
      const live = this.liveState(vehicleId);
      if (isActiveSession(session) && session) {
        live.setPushDetails(session);
        const now = this.now();
        const field = (r: LiveSessionData["power"], scale = 1): number | null => {
          const n = num(r?.value);
          return n == null ? null : n * scale;
        };
        const reading = (
          name: Parameters<LiveChargeState["observe"]>[0],
          r: LiveSessionData["power"],
        ) => {
          const value = name === "chargerState" ? (r?.value == null ? null : String(r.value)) : field(r);
          // Only what the push actually carried: absent is unknown, not 0.
          if (value == null) return;
          live.observe(name, "push", value, r?.updatedAt ? Date.parse(r.updatedAt) : now, now);
        };
        reading("chargerState", session.vehicleChargerState);
        reading("powerKw", session.power);
        // No SoC: the push copies it from its last chart point, which can be
        // minutes behind; vehicle state and Parallax report it directly.
        reading("secondsLeft", session.timeRemaining);
        reading("energyKwh", session.totalChargedEnergy);
        reading("rangeAddedKm", session.rangeAddedThisSession);
        reading("rangeKmPerHour", session.kilometersChargedPerHour);
      } else {
        live.clearPush();
      }
      this.emitLive(vehicleId);
    });
  }

  private liveState(vehicleId: string): LiveChargeState {
    let live = this.live.get(vehicleId);
    if (!live) {
      live = new LiveChargeState();
      this.live.set(vehicleId, live);
    }
    return live;
  }

  /** Records readings from one source, then re-emits the merged session. */
  private observe(
    vehicleId: string,
    source: LiveSource,
    at: number,
    readings: readonly (readonly [Parameters<LiveChargeState["observe"]>[0], number | string | null])[],
  ): void {
    const live = this.liveState(vehicleId);
    const now = this.now();
    for (const [field, value] of readings) live.observe(field, source, value, at, now);
    // After queued work, so a plug-in has opened its session first.
    void this.enqueue(vehicleId, async () => this.emitLive(vehicleId));
  }

  /**
   * The one live session for the vehicle, merged field by field from the
   * push feed, Parallax and vehicle state, so the dashboard never flips
   * between sources (Rivian's push is silent for some chargers).
   */
  private emitLive(vehicleId: string): void {
    const open = this.openSessions.get(vehicleId);
    const session = open ? this.liveState(vehicleId).session(open.startedAt, this.now()) : null;
    // Compare without timestamps: each report re-stamps them.
    const signature = JSON.stringify(session, (_key, v: unknown) =>
      v && typeof v === "object" && "updatedAt" in v && "value" in v ? v.value : v,
    );
    if (this.liveSent.get(vehicleId) === signature) return;
    this.liveSent.set(vehicleId, signature);
    this.bus.emitChargingSession(vehicleId, session);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.loadResumableSessions();
    // One wallbox refresh at startup keeps names/firmware current.
    try {
      await this.pollWallboxes();
    } catch (err) {
      this.handleError(err, "wallbox refresh");
    }
    this.reschedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private reschedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.running || this.pluggedIn.size === 0) return;
    const due = Math.max(0, this.lastWallboxPollAt + WALLBOX_INTERVAL_MS - this.now());
    this.timer = setTimeout(() => void this.tick(), due);
  }

  private async tick(): Promise<void> {
    this.timer = undefined;
    try {
      await this.pollWallboxes();
    } catch (err) {
      this.handleError(err, "wallbox refresh");
    }
    this.reschedule();
  }

  private handleError(err: unknown, what: string): void {
    if (err instanceof RivianUnauthenticatedError) {
      this.log(`${what}: credentials rejected`);
      this.onAuthFailure?.();
      return;
    }
    const kind = err instanceof RivianRateLimitError ? "rate limited" : "failed";
    this.log(`${what} ${kind}: ${(err as Error).message}`);
  }

  private enqueue(vehicleId: string, task: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(vehicleId) ?? Promise.resolve();
    const next = prev.then(task).catch((err: unknown) => {
      this.log(`charging persistence error: ${(err as Error).message}`);
    });
    this.chains.set(vehicleId, next);
    return next;
  }

  /** Plug-in opens a session, unplug closes it; charging time and SOC in between. */
  private async processPlugReading(vehicleId: string, reading: PlugReading): Promise<void> {
    await this.settleResumable(vehicleId, reading.plugged);
    const open = this.openSessions.get(vehicleId);

    if (!reading.plugged) {
      if (open) {
        const endedAt = Math.min(Math.max(reading.pluggedAt, open.startedAt), this.now());
        await this.closeOpen(vehicleId, open, endedAt, reading.soc);
        this.emitLive(vehicleId);
      }
      return;
    }

    if (!open) {
      const startedAt = this.now();
      const chargingSince = reading.charging ? Math.max(reading.chargingAt, startedAt) : null;
      await this.openSession(vehicleId, {
        startedAt,
        startSoc: reading.soc,
        chargingSince,
      });
      return;
    }

    const changes: Partial<typeof chargingSessions.$inferInsert> = {};
    if (reading.charging && open.chargingSince === null) {
      open.chargingSince = Math.max(reading.chargingAt, open.startedAt);
      changes.chargingSince = new Date(open.chargingSince);
    } else if (!reading.charging && open.chargingSince !== null) {
      open.chargingSeconds += stretchSeconds(open.chargingSince, reading.chargingAt);
      open.chargingSince = null;
      changes.chargingSeconds = open.chargingSeconds;
      changes.chargingSince = null;
    }
    if (reading.soc !== null) changes.endSoc = reading.soc;
    if (Object.keys(changes).length === 0) return;
    await this.db.update(chargingSessions).set(changes).where(eq(chargingSessions.id, open.id));
  }

  private async openSession(
    vehicleId: string,
    init: { startedAt: number; startSoc: number | null; chargingSince: number | null },
    live?: LiveSessionData,
  ): Promise<OpenSession> {
    const loc = this.latestLocation.get(vehicleId);
    const wallbox = await this.wallboxAt(loc);
    const isRivianCharger = live?.isRivianCharger ?? null;
    const [row] = await this.db
      .insert(chargingSessions)
      .values({
        vehicleId,
        startedAt: new Date(init.startedAt),
        chargerId: live?.chargerId ?? null,
        chargerType: wallbox
          ? "wallbox"
          : isRivianCharger == null
            ? null
            : isRivianCharger
              ? "rivian_charger"
              : "other",
        wallboxId: wallbox?.wallboxId ?? null,
        isRivianCharger,
        startSoc: init.startSoc,
        endSoc: init.startSoc,
        chargingSeconds: 0,
        chargingSince: init.chargingSince != null ? new Date(init.chargingSince) : null,
        currency: live?.currentCurrency ?? null,
        lat: loc?.lat,
        lon: loc?.lon,
      })
      .returning({ id: chargingSessions.id });
    const open: OpenSession = {
      id: row!.id,
      startedAt: init.startedAt,
      powerSum: 0,
      powerCount: 0,
      maxPowerKw: 0,
      chargingSeconds: 0,
      chargingSince: init.chargingSince,
    };
    this.openSessions.set(vehicleId, open);
    this.liveState(vehicleId).forgetSessionReadings(init.startedAt);
    this.log(`charging session started for ${vehicleId}`);
    return open;
  }

  private async closeOpen(
    vehicleId: string,
    open: OpenSession,
    endedAt: number,
    soc: number | null,
  ): Promise<void> {
    if (open.chargingSince !== null) {
      open.chargingSeconds += stretchSeconds(open.chargingSince, endedAt);
      open.chargingSince = null;
    }
    await this.db
      .update(chargingSessions)
      .set({
        endedAt: new Date(endedAt),
        chargingSeconds: open.chargingSeconds,
        chargingSince: null,
        ...(soc !== null ? { endSoc: soc } : {}),
      })
      .where(eq(chargingSessions.id, open.id));
    this.openSessions.delete(vehicleId);
    this.liveState(vehicleId).forgetSessionReadings(endedAt);
    // A finished charge has no forecast.
    await this.replaceForecast(open.id, []);
    this.log(`charging session ended for ${vehicleId}`);
    this.onSessionEnded?.(vehicleId);
  }

  /** Push feed: adds power, energy, cost and curve to the plug-in's session. */
  private async processSession(
    vehicleId: string,
    session: LiveSessionData | null,
  ): Promise<void> {
    const active = isActiveSession(session);
    // Without plug state, the push feed is all we have to bound a session.
    if (!this.plugKnown.has(vehicleId)) await this.settleResumable(vehicleId, active);
    let open = this.openSessions.get(vehicleId);

    if (!active || !session) {
      if (open && !this.plugKnown.has(vehicleId)) {
        await this.closeOpen(vehicleId, open, this.now(), null);
      }
      return;
    }

    if (!open) {
      const now = this.now();
      const start = session.startTime ? Date.parse(session.startTime) : Number.NaN;
      open = await this.openSession(
        vehicleId,
        {
          startedAt: Number.isFinite(start) && start <= now ? start : now,
          startSoc: num(session.soc?.value),
          chargingSince: this.plugKnown.has(vehicleId) ? null : now,
        },
        session,
      );
    }

    const power = num(session.power?.value);
    if (power != null) {
      open.powerSum += power;
      open.powerCount += 1;
      open.maxPowerKw = Math.max(open.maxPowerKw, power);
    }
    const soc = num(session.soc?.value);
    await this.db
      .update(chargingSessions)
      .set({
        ...(soc != null ? { endSoc: soc } : {}),
        energyKwh: num(session.totalChargedEnergy?.value),
        rangeAddedKm: num(session.rangeAddedThisSession?.value),
        // Only when the push feed reported power, so Parallax figures stand.
        ...(open.powerCount
          ? { avgPowerKw: open.powerSum / open.powerCount, maxPowerKw: open.maxPowerKw }
          : {}),
        ...(session.isRivianCharger != null ? { isRivianCharger: session.isRivianCharger } : {}),
        ...(session.chargerId ? { chargerId: session.chargerId } : {}),
        cost: session.currentPrice != null ? String(session.currentPrice) : undefined,
        rawFinal: session,
      })
      .where(eq(chargingSessions.id, open.id));
    await this.recordCurve(vehicleId, open.id, session);
  }

  /**
   * Stores curve samples, each series under its own source: the
   * subscription's chart points, and the current reading. The reading's SoC
   * is the vehicle's own, when recent: the push copies its SoC from its last
   * chart point, and pairing that with fresh power put stale SoC on the curve.
   */
  private async recordCurve(vehicleId: string, sessionId: number, session: LiveSessionData): Promise<void> {
    const rows: (typeof chargingCurvePoints.$inferInsert)[] = [];
    for (const s of session.chart ?? []) {
      const ts = Date.parse(s.ts);
      if (Number.isNaN(ts) || (s.powerKw == null && s.soc == null)) continue;
      rows.push({ sessionId, source: "push_chart", ts: new Date(ts), powerKw: s.powerKw, soc: s.soc });
    }
    const power = num(session.power?.value);
    const at = Date.parse(session.power?.updatedAt ?? "");
    if (power != null) {
      const now = this.now();
      const ts = Number.isNaN(at) ? now : Math.min(at, now);
      const soc = this.liveState(vehicleId).resolve<number | null>("soc", now);
      rows.push({
        sessionId,
        source: "push_live",
        ts: new Date(ts),
        powerKw: power,
        soc: soc && soc.source !== "push" && Math.abs(ts - soc.at) <= LIVE_SOC_MAX_GAP_MS ? soc.value : null,
      });
    }
    if (rows.length === 0) return;
    await this.db.insert(chargingCurvePoints).values(rows).onConflictDoNothing();
  }

  /** The registered wallbox the vehicle is parked at, if any. */
  private async wallboxAt(
    loc: { lat: number; lon: number } | undefined,
  ): Promise<{ wallboxId: string } | null> {
    if (!loc) return null;
    const boxes = await this.db
      .select({ wallboxId: wallboxes.wallboxId, lat: wallboxes.latitude, lon: wallboxes.longitude })
      .from(wallboxes);
    const spots = boxes
      .filter((b) => b.lat != null && b.lon != null)
      .map((b) => ({ wallboxId: b.wallboxId, lat: b.lat!, lon: b.lon! }));
    return nearbySpot(loc.lat, loc.lon, spots);
  }

  private async pollWallboxes(): Promise<void> {
    this.lastWallboxPollAt = this.now();
    const boxes = await this.api.getRegisteredWallboxes();
    this.onAuthOk?.();
    for (const box of boxes) {
      await this.db
        .insert(wallboxes)
        .values({
          wallboxId: box.wallboxId,
          name: box.name,
          model: box.model,
          serialNumber: box.serialNumber,
          softwareVersion: box.softwareVersion,
          maxAmps: box.maxAmps,
          maxVoltage: box.maxVoltage,
          maxPower: box.maxPower,
          latitude: box.latitude,
          longitude: box.longitude,
          linked: box.linked,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: wallboxes.wallboxId,
          set: {
            name: box.name,
            softwareVersion: box.softwareVersion,
            linked: box.linked,
            updatedAt: new Date(),
          },
        });

      const signature = `${box.chargingStatus}|${box.power}|${box.currentVoltage}|${box.currentAmps}`;
      if (this.lastWallboxReading.get(box.wallboxId) === signature) continue;
      this.lastWallboxReading.set(box.wallboxId, signature);
      await this.db.insert(wallboxReadings).values({
        wallboxId: box.wallboxId,
        ts: new Date(),
        chargingStatus: box.chargingStatus,
        power: box.power,
        currentVoltage: box.currentVoltage,
        currentAmps: box.currentAmps,
      });
    }
  }

  /**
   * Sessions the previous run left open. They aren't closed blindly: a
   * restart mid-charge would split one plug-in in two. Each waits for the
   * plug state: still plugged in continues it, unplugged closes it.
   */
  private async loadResumableSessions(): Promise<void> {
    const rows = await this.db
      .select({
        id: chargingSessions.id,
        vehicleId: chargingSessions.vehicleId,
        startedAt: chargingSessions.startedAt,
        chargingSeconds: chargingSessions.chargingSeconds,
        chargingSince: chargingSessions.chargingSince,
        lastSampleAt: sql<string | null>`(SELECT MAX(ts) FROM charging_curve_points p WHERE p.session_id = ${chargingSessions.id} AND p.source <> 'forecast')`,
      })
      .from(chargingSessions)
      .where(isNull(chargingSessions.endedAt))
      .orderBy(chargingSessions.startedAt);
    for (const row of rows) {
      const candidate: ResumableSession = {
        id: row.id,
        startedAt: row.startedAt,
        lastSampleAt: row.lastSampleAt ? new Date(row.lastSampleAt) : null,
        chargingSeconds: row.chargingSeconds,
        chargingSince: row.chargingSince,
      };
      const previous = this.resumable.get(row.vehicleId);
      if (previous) await this.closeSession(previous); // only the newest can still be running
      if (this.vehicles.has(row.vehicleId)) {
        this.resumable.set(row.vehicleId, candidate);
      } else {
        await this.closeSession(candidate);
      }
    }
  }

  /**
   * Continue the leftover session if the vehicle is still plugged in (or,
   * without plug state, still charging); otherwise close it.
   */
  private async settleResumable(vehicleId: string, stillGoing: boolean): Promise<void> {
    const leftover = this.resumable.get(vehicleId);
    if (!leftover) return;
    this.resumable.delete(vehicleId);
    if (!stillGoing || this.openSessions.has(vehicleId)) {
      await this.closeSession(leftover);
      return;
    }
    const [stats] = await this.db
      .select({
        avg: sql<number | null>`AVG(power_kw)::float8`,
        max: sql<number | null>`MAX(power_kw)::float8`,
        count: sql<number>`COUNT(power_kw)::int`,
      })
      .from(chargingCurvePoints)
      .where(and(eq(chargingCurvePoints.sessionId, leftover.id), ne(chargingCurvePoints.source, "forecast")));
    const count = stats?.count ?? 0;
    this.openSessions.set(vehicleId, {
      id: leftover.id,
      startedAt: leftover.startedAt.getTime(),
      powerSum: (stats?.avg ?? 0) * count,
      powerCount: count,
      maxPowerKw: stats?.max ?? 0,
      chargingSeconds: leftover.chargingSeconds ?? 0,
      chargingSince: leftover.chargingSince?.getTime() ?? null,
    });
    this.log(`charging session resumed for ${vehicleId}`);
  }

  private async closeSession(session: ResumableSession): Promise<void> {
    const endedAt = closeTime(session);
    const since = session.chargingSince;
    await this.db
      .update(chargingSessions)
      .set({
        endedAt,
        chargingSince: null,
        ...(since
          ? { chargingSeconds: (session.chargingSeconds ?? 0) + stretchSeconds(since.getTime(), endedAt.getTime()) }
          : {}),
      })
      .where(eq(chargingSessions.id, session.id));
  }
}

/** Whole seconds from `since` to `until`, never negative. */
function stretchSeconds(since: number, until: number): number {
  return Math.max(0, Math.round((until - since) / 1000));
}

const ACTIVE_CHARGER_STATES = new Set([
  "charging_active",
  "charging_connecting",
  "charging_ready",
  "charging",
]);

export function isActiveSession(session: LiveSessionData | null): boolean {
  if (!session) return false;
  const state = session.vehicleChargerState?.value;
  if (typeof state === "string") {
    return ACTIVE_CHARGER_STATES.has(state.toLowerCase());
  }
  return session.startTime != null;
}

/**
 * When a charging graph was sent: Rivian's message time, or now when it's
 * missing, in the future, or before the graph's own first bar (implausible).
 */
function graphSentAt(timestamp: number | null, firstBarMs: number, now: number): number {
  const sent = parallaxTime(timestamp);
  if (sent == null || sent > now || sent < firstBarMs) return now;
  return sent;
}

/** Rivian's Parallax message time (seconds or milliseconds), if given. */
function parallaxTime(timestamp: number | null): number | null {
  if (!timestamp) return null;
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

function num(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
