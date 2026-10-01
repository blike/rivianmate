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
import type { LiveSessionData } from "../rivian/types.js";
import { ChargingMonitor } from "./charging-monitor.js";
import { LiveBus } from "./live-bus.js";

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)("ChargingMonitor with Postgres", () => {
  let handle: ReturnType<typeof createDb>;
  const NOW = Date.parse("2026-10-01T12:00:00Z");
  const api = { getRegisteredWallboxes: async () => [] } as unknown as RivianApi;

  const monitor = () => {
    const m = new ChargingMonitor(handle.db, api, new LiveBus(), () => {}, () => NOW);
    m.setVehicles(["v1"]);
    return m;
  };
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

  it("closes the leftover at its last sample when a different charge is running", async () => {
    const id = await leftover("2026-10-01T08:00:00Z", [["2026-10-01T09:30:00Z", 11]]);
    const m = monitor();
    await m.start();
    m.setPluggedIn("v1", true);
    await m.ingest("v1", live("2026-10-01T11:55:00Z"));
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
