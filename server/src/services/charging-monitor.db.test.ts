/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, runMigrations } from "../db/client.js";
import { chargingCurvePoints, chargingSessions, vehicles } from "../db/schema.js";
import type { RivianApi } from "../rivian/client.js";
import type { LiveSessionData, VehicleState } from "../rivian/types.js";
import { RVM_CHARGING_GRAPH } from "../rivian/parallax.js";
import { chargingGraph, graphBar } from "../testing/protobuf.js";
import { ChargingMonitor } from "./charging-monitor.js";
import { LiveBus } from "./live-bus.js";

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)("ChargingMonitor with Postgres", () => {
  let handle: ReturnType<typeof createDb>;
  const NOW = Date.parse("2026-10-01T12:00:00Z");
  const api = { getRegisteredWallboxes: async () => [] } as unknown as RivianApi;
  let clock = NOW;

  const monitor = () => {
    const m = new ChargingMonitor(handle.db, api, new LiveBus(), () => {}, () => clock);
    m.setVehicles(["v1"]);
    return m;
  };
  /** Vehicle state as the monitor sees it, stamped by Rivian at `at`. */
  const vehicle = (status: string, chargerState: string, soc: number, at: string): VehicleState => ({
    chargerStatus: { value: status, timeStamp: at },
    chargerState: { value: chargerState, timeStamp: at },
    batteryLevel: { value: soc, timeStamp: at },
  });
  /** Feed a state at time `at` and wait for it to be stored. */
  async function note(m: ChargingMonitor, at: string, status: string, chargerState: string, soc: number) {
    clock = Date.parse(at);
    m.noteState("v1", vehicle(status, chargerState, soc, at));
    await m.ingest("v1", null); // queued after the state: drains it
  }
  const PLUGGED = "chrgr_sts_connected_no_chrg";
  const CHARGING = "chrgr_sts_connected_charging";
  const UNPLUGGED = "chrgr_sts_not_connected";
  const live = (startTime: string, power = 10, soc = 50): LiveSessionData =>
    ({
      startTime,
      power: { value: power, updatedAt: new Date(NOW).toISOString() },
      soc: { value: soc, updatedAt: new Date(NOW).toISOString() },
      vehicleChargerState: { value: "charging_active", updatedAt: new Date(NOW).toISOString() },
    }) as LiveSessionData;

  async function leftover(startedAt: string, samples: [string, number][]) {
    const [row] = await handle.db
      .insert(chargingSessions)
      .values({ vehicleId: "v1", startedAt: new Date(startedAt) })
      .returning();
    if (samples.length) {
      await handle.db.insert(chargingCurvePoints).values(
        samples.map(([ts, kw]) => ({ sessionId: row!.id, ts: new Date(ts), powerKw: kw })),
      );
    }
    return row!.id;
  }
  const sessions = () => handle.db.select().from(chargingSessions).orderBy(chargingSessions.id);

  beforeAll(async () => {
    await runMigrations(url!, join(here, "..", "..", "drizzle"));
    handle = createDb(url!);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE charging_curve_points, charging_sessions, vehicles RESTART IDENTITY CASCADE`;
    await handle.db.insert(vehicles).values({ id: "v1", vin: "VIN1" });
    clock = NOW;
  });

  it("keeps one session per plug-in, with charging time and SOC across pauses", async () => {
    const m = monitor();
    await m.start();
    await note(m, "2026-10-01T00:30:00Z", PLUGGED, "charging_scheduled", 40);
    await note(m, "2026-10-01T07:00:00Z", CHARGING, "charging_active", 40);
    await note(m, "2026-10-01T11:00:00Z", PLUGGED, "charging_complete", 70);
    await note(m, "2026-10-01T12:00:00Z", CHARGING, "charging_active", 70); // top-up
    await note(m, "2026-10-01T12:15:00Z", UNPLUGGED, "charging_ready", 71);
    m.stop();

    const rows = await sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.startedAt.toISOString()).toBe("2026-10-01T00:30:00.000Z");
    expect(rows[0]!.endedAt?.toISOString()).toBe("2026-10-01T12:15:00.000Z");
    expect(rows[0]!.chargingSeconds).toBe(4 * 3600 + 15 * 60);
    expect(rows[0]!.chargingSince).toBeNull();
    expect([rows[0]!.startSoc, rows[0]!.endSoc]).toEqual([40, 71]);
  });

  it("continues a plug-in across a restart, keeping its charging time", async () => {
    const before = monitor();
    await before.start();
    await note(before, "2026-10-01T07:00:00Z", CHARGING, "charging_active", 40);
    before.stop();

    const after = monitor();
    await after.start();
    await note(after, "2026-10-01T09:00:00Z", CHARGING, "charging_active", 55);
    await note(after, "2026-10-01T10:00:00Z", UNPLUGGED, "charging_ready", 62);
    after.stop();

    const rows = await sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.chargingSeconds).toBe(3 * 3600);
    expect([rows[0]!.startSoc, rows[0]!.endSoc]).toEqual([40, 62]);
  });

  it("stores the Parallax charging graph as the session's power curve", async () => {
    const m = monitor();
    await m.start();
    await note(m, "2026-10-01T07:00:00Z", CHARGING, "charging_active", 40);
    const t0 = Date.parse("2026-10-01T07:00:00Z");
    const graph = (lastKw: number) => ({
      rvm: RVM_CHARGING_GRAPH,
      timestamp: null,
      payload: chargingGraph(
        graphBar(40, 11, t0, t0 + 60_000),
        graphBar(41, lastKw, t0 + 60_000, t0 + 120_000),
        graphBar(30, 50, t0 - 2 * 86_400_000, t0 - 2 * 86_400_000 + 60_000), // days old: dropped
      ),
    });
    await m.ingestParallax("v1", graph(9));
    await m.ingestParallax("v1", graph(10.5)); // the growing bar is re-sent
    await m.ingestParallax("v1", { rvm: "charging.session.status", timestamp: null, payload: "CAEQAQ==" });
    m.stop();

    const [session] = await sessions();
    const points = await handle.db
      .select()
      .from(chargingCurvePoints)
      .where(eq(chargingCurvePoints.sessionId, session!.id))
      .orderBy(chargingCurvePoints.ts);
    expect(points.map((p) => [p.powerKw, p.soc])).toEqual([[11, 40], [10.5, 41]]);
    expect(session!.maxPowerKw).toBe(11);
    expect(session!.avgPowerKw).toBeCloseTo(10.75);
  });

  it("fills a finished session's curve from the graph Rivian sends on subscribe", async () => {
    const [done] = await handle.db
      .insert(chargingSessions)
      .values({
        vehicleId: "v1",
        startedAt: new Date("2026-10-01T00:34:54Z"),
        endedAt: new Date("2026-10-01T12:31:09Z"),
      })
      .returning();
    const at = (iso: string) => Date.parse(iso);
    const m = monitor();
    await m.start();
    await m.ingestParallax("v1", {
      rvm: RVM_CHARGING_GRAPH,
      timestamp: null,
      payload: chargingGraph(
        graphBar(40, 0, at("2026-10-01T00:35:00Z"), at("2026-10-01T01:07:00Z")),
        graphBar(43, 7.4, at("2026-10-01T07:09:00Z"), at("2026-10-01T07:41:00Z")),
        graphBar(70, 0, at("2026-10-01T11:57:00Z"), at("2026-10-01T12:29:00Z")),
      ),
    });
    m.stop();

    const points = await handle.db
      .select()
      .from(chargingCurvePoints)
      .where(eq(chargingCurvePoints.sessionId, done!.id))
      .orderBy(chargingCurvePoints.ts);
    expect(points.map((p) => p.soc)).toEqual([40, 43, 70]);
    const [row] = await sessions();
    expect(row!.maxPowerKw).toBeCloseTo(7.4);
  });

  it("adds push-feed power and energy to the plug-in's session", async () => {
    const m = monitor();
    await m.start();
    await note(m, "2026-10-01T11:00:00Z", CHARGING, "charging_active", 50);
    await m.ingest("v1", { ...live("2026-10-01T11:00:00Z", 11), totalChargedEnergy: { value: 5 } } as LiveSessionData);
    m.stop();

    const rows = await sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.maxPowerKw).toBe(11);
    expect(rows[0]!.energyKwh).toBe(5);
  });

  it("resumes a session left open by a restart when the same charge continues", async () => {
    const id = await leftover("2026-10-01T11:00:00Z", [
      ["2026-10-01T11:10:00Z", 11],
      ["2026-10-01T11:50:00Z", 7],
    ]);
    const m = monitor();
    await m.start();
    m.setPluggedIn("v1", true);
    await m.ingest("v1", live("2026-10-01T11:02:00Z", 9));
    m.stop();

    const rows = await sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(id);
    expect(rows[0]!.endedAt).toBeNull();
    expect(rows[0]!.maxPowerKw).toBe(11);
    expect(rows[0]!.avgPowerKw).toBeCloseTo(9); // (11 + 7 + 9) / 3
  });

  it("closes the leftover at its last sample and starts anew after unplug and replug", async () => {
    const id = await leftover("2026-10-01T08:00:00Z", [["2026-10-01T09:30:00Z", 11]]);
    const m = monitor();
    await m.start();
    m.setPluggedIn("v1", false);
    m.setPluggedIn("v1", true);
    await m.ingest("v1", null);
    m.stop();

    const rows = await sessions();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === id)!.endedAt?.toISOString()).toBe("2026-10-01T09:30:00.000Z");
    expect(rows.find((r) => r.id !== id)!.endedAt).toBeNull();
  });

  it("closes the leftover when the vehicle is reported unplugged", async () => {
    const id = await leftover("2026-10-01T08:00:00Z", [["2026-10-01T09:00:00Z", 11]]);
    const m = monitor();
    await m.start();
    m.setPluggedIn("v1", false);
    await m.ingest("v1", null); // let queued work drain
    m.stop();

    const [row] = await handle.db.select().from(chargingSessions).where(eq(chargingSessions.id, id));
    expect(row!.endedAt?.toISOString()).toBe("2026-10-01T09:00:00.000Z");
  });

  it("keeps the leftover open while the plug state is unknown", async () => {
    await leftover("2026-10-01T11:00:00Z", [["2026-10-01T11:50:00Z", 11]]);
    const m = monitor();
    await m.start();
    m.stop();
    const rows = await sessions();
    expect(rows[0]!.endedAt).toBeNull();
  });
});
