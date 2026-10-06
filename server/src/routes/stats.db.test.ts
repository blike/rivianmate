/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import Fastify, { type FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DcCurvesDto, ProjectedRangeDto, StatsDto } from "../api-types.js";
import type { AppContext } from "../context.js";
import { createDb, runMigrations } from "../db/client.js";
import {
  chargingCurvePoints,
  chargingSessions,
  drives,
  locationPoints,
  vehicleStateSnapshots,
  vehicles,
} from "../db/schema.js";
import { healthRoutes } from "./health.js";
import { statsRoutes } from "./stats.js";

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

const daysAgo = (days: number, hour = 12) => {
  const d = new Date(Date.now() - days * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

describe.skipIf(!url)("stats routes with Postgres", () => {
  let handle: ReturnType<typeof createDb>;
  let app: FastifyInstance;

  beforeAll(async () => {
    await runMigrations(url!, join(here, "..", "..", "drizzle"));
    handle = createDb(url!);
    app = Fastify();
    const ctx = { db: handle.db, monitor: { getState: () => undefined } } as unknown as AppContext;
    await statsRoutes(app, ctx);
    await healthRoutes(app, ctx);
  });
  afterAll(async () => {
    await app.close();
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE vehicles, app_settings RESTART IDENTITY CASCADE`;
    await handle.db.insert(vehicles).values({ id: "v1", vin: "VIN1" });
  });

  const get = async <T>(path: string): Promise<T> => {
    const res = await app.inject({ method: "GET", url: path });
    expect(res.statusCode).toBe(200);
    return res.json() as T;
  };

  it("totals drives and charging within the period", async () => {
    const [recent] = await handle.db
      .insert(drives)
      .values([
        {
          vehicleId: "v1",
          startedAt: daysAgo(2),
          endedAt: new Date(daysAgo(2).getTime() + 3600_000),
          distanceKm: 100,
          startBattery: 80,
          endBattery: 64,
          batteryCapacityKwh: 125,
          driveMode: "everyday",
        },
        // Too old for a 30-day period.
        { vehicleId: "v1", startedAt: daysAgo(60), endedAt: daysAgo(60, 13), distanceKm: 40 },
        // Still driving: left out.
        { vehicleId: "v1", startedAt: daysAgo(0, 0), endedAt: null, distanceKm: 5 },
      ])
      .returning();
    await handle.db.insert(locationPoints).values([
      { vehicleId: "v1", ts: daysAgo(2, 12), lat: 1, lon: 1, speedKmh: 112, driveId: recent!.id },
      { vehicleId: "v1", ts: daysAgo(60, 12), lat: 1, lon: 1, speedKmh: 150, driveId: null },
    ]);
    await handle.db.insert(vehicleStateSnapshots).values({ vehicleId: "v1", ts: daysAgo(1), mileageM: 12_345_000, data: {} });
    await handle.db.insert(chargingSessions).values([
      { vehicleId: "v1", startedAt: daysAgo(3), endedAt: daysAgo(3, 13), energyKwh: 60, maxPowerKw: 190, cost: "24.00", currency: "USD", vendor: "Tesla" },
      { vehicleId: "v1", startedAt: daysAgo(5), endedAt: daysAgo(5, 20), energyKwh: 40, maxPowerKw: 11, isHomeCharger: true },
    ]);

    const r = await get<StatsDto>("/api/vehicles/v1/stats?days=30&tz=UTC");
    expect(r.drives).toHaveLength(1);
    expect(r.drives[0]).toMatchObject({ distanceKm: 100, durationS: 3600, driveMode: "everyday" });
    expect(r.drives[0]!.energyKwh).toBeCloseTo(20);
    expect(r.driving).toMatchObject({ drives: 1, distanceKm: 100, topSpeedKmh: 112 });
    expect(r.odometerKm).toBeCloseTo(12_345);
    expect(r.charging).toMatchObject({ sessions: 2, energyKwh: 100, homeKwh: 40, awayKwh: 60, acSessions: 1, dcSessions: 1 });
    expect(r.charging.networks.map((n) => n.name)).toEqual(["Tesla Supercharger", "Home"]);
    expect(r.charging.pricePerKwh).toEqual({ currency: "USD", amount: 0.4 });

    const all = await get<StatsDto>("/api/vehicles/v1/stats");
    expect(all.since).toBeNull();
    expect(all.driving.drives).toBe(2);
    expect(all.driving.topSpeedKmh).toBe(112);
  });

  it("returns DC sessions' power by battery level", async () => {
    const [dc, ac] = await handle.db
      .insert(chargingSessions)
      .values([
        { vehicleId: "v1", startedAt: daysAgo(3), endedAt: daysAgo(3, 13), energyKwh: 60, maxPowerKw: 190, chargerType: "rivian_charger" },
        { vehicleId: "v1", startedAt: daysAgo(4), endedAt: daysAgo(4, 20), energyKwh: 40, maxPowerKw: 11 },
      ])
      .returning();
    const curve = (sessionId: number, source: "graph" | "forecast", points: [number, number][]) =>
      points.map(([soc, powerKw], i) => ({
        sessionId,
        source,
        ts: new Date(daysAgo(3).getTime() + i * 60_000),
        soc,
        powerKw,
      }));
    await handle.db.insert(chargingCurvePoints).values([
      ...curve(dc!.id, "graph", [[20, 180], [20.4, 190], [40, 150], [60, 90]]),
      ...curve(ac!.id, "graph", [[50, 11], [60, 11]]),
    ]);

    const r = await get<DcCurvesDto>("/api/vehicles/v1/stats/dc-curves?days=30");
    expect(r.sessions).toEqual([
      { id: dc!.id, startedAt: daysAgo(3).toISOString(), network: "Rivian Adventure Network", maxPowerKw: 190 },
    ]);
    expect(r.points).toEqual([
      { sessionId: dc!.id, soc: 20, powerKw: 185 },
      { sessionId: dc!.id, soc: 40, powerKw: 150 },
      { sessionId: dc!.id, soc: 60, powerKw: 90 },
    ]);
  });

  it("projects range to a full battery per local day", async () => {
    await handle.db.insert(vehicleStateSnapshots).values([
      { vehicleId: "v1", ts: daysAgo(2, 10), batteryLevel: 80, rangeKm: 400, data: {} },
      { vehicleId: "v1", ts: daysAgo(2, 11), batteryLevel: 50, rangeKm: 260, data: {} },
      { vehicleId: "v1", ts: daysAgo(2, 12), batteryLevel: 60, rangeKm: 306, data: {} },
      // Too low to scale up.
      { vehicleId: "v1", ts: daysAgo(2, 13), batteryLevel: 10, rangeKm: 20, data: {} },
      { vehicleId: "v1", ts: daysAgo(1, 12), batteryLevel: 90, rangeKm: 441, data: {} },
    ]);
    const r = await get<ProjectedRangeDto>("/api/vehicles/v1/health/projected-range?days=30&tz=UTC");
    expect(r.days.map((d) => d.readings)).toEqual([3, 1]);
    expect(r.days[0]!.rangeKm).toBeCloseTo(510);
    expect(r.days[1]!.rangeKm).toBeCloseTo(490);
    expect(r.days[0]!.day).toBe(daysAgo(2).toISOString().slice(0, 10));
  });
});
