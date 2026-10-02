/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, runMigrations } from "../db/client.js";
import { parallaxLatest, parallaxMessages, vehicles } from "../db/schema.js";
import { RVM_BATTERY_STATE, RVM_NETWORK, RVM_PARKED_ENERGY, RVM_TIME_ESTIMATION } from "../rivian/parallax.js";
import { b64, double, float, int, message, string } from "../testing/protobuf.js";
import { ParallaxStore } from "./parallax-store.js";

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)("ParallaxStore with Postgres", () => {
  let handle: ReturnType<typeof createDb>;
  const at = Date.parse("2026-10-01T13:40:00Z");
  const battery = (soc: number, temps?: [number, number, number]) => ({
    rvm: RVM_BATTERY_STATE,
    timestamp: at,
    payload: b64([
      ...message(1, [...double(1, soc), ...double(2, 111.285)]),
      ...(temps ? message(2, [...float(1, temps[0]), ...float(2, temps[1]), ...float(3, temps[2])]) : []),
    ]),
  });

  beforeAll(async () => {
    await runMigrations(url!, join(here, "..", "..", "drizzle"));
    handle = createDb(url!);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE vehicles RESTART IDENTITY CASCADE`;
    await handle.db.insert(vehicles).values({ id: "v1", vin: "VIN1" });
  });

  it("keeps the last awake cell temperatures after the vehicle sleeps", async () => {
    const store = new ParallaxStore(handle.db);
    await store.ingest("v1", battery(60, [30, 33, 28]));
    await store.ingest("v1", battery(59.5)); // asleep: no temperatures

    const insights = await store.insights("v1");
    expect(insights.cellTemps).toEqual({ avgC: 30, maxC: 33, minC: 28, at: new Date(at).toISOString() });
    expect(insights.cellTempsCurrent).toBe(false);
  });

  it("decodes stored topics and ignores ones it doesn't keep", async () => {
    const store = new ParallaxStore(handle.db);
    await store.ingest("v1", {
      rvm: RVM_PARKED_ENERGY,
      timestamp: null,
      payload: b64(message(1, [...float(1, 1.1), ...float(6, 5.3), ...int(11, 1440)])),
    });
    await store.ingest("v1", {
      rvm: RVM_NETWORK,
      timestamp: at / 1000, // seconds
      payload: b64(message(5, [...string(1, "AT&T"), ...string(2, "LTE")])),
    });
    await store.ingest("v1", { rvm: "body.locks.states", timestamp: null, payload: "CAE=" });

    const insights = await store.insights("v1");
    expect(insights.parkedEnergy?.windows).toEqual([{ minutes: 1440, kwh: expect.closeTo(1.1), rangeKm: expect.closeTo(5.3) }]);
    expect(insights.connectivity).toEqual({
      wifi: null,
      cellular: { carrier: "AT&T", technology: "LTE" },
      at: new Date(at).toISOString(),
    });
    expect(insights.coldWeather).toBeNull();
    const rows = await handle.db.select({ rvm: parallaxLatest.rvm }).from(parallaxLatest);
    expect(rows.map((r) => r.rvm).sort()).toEqual([RVM_PARKED_ENERGY, RVM_NETWORK]);
  });

  it("logs each distinct payload of logged topics, but not other topics", async () => {
    const store = new ParallaxStore(handle.db);
    const estimate = (seconds: number) => ({ rvm: RVM_TIME_ESTIMATION, timestamp: at, payload: b64(int(1, seconds)) });
    await store.ingest("v1", estimate(3600));
    await store.ingest("v1", estimate(3600)); // repeat
    await store.ingest("v1", estimate(3000));
    await store.ingest("v1", battery(60));

    const logged = await handle.db.select().from(parallaxMessages).orderBy(parallaxMessages.id);
    expect(logged.map((r) => [r.rvm, r.payload])).toEqual([
      [RVM_TIME_ESTIMATION, b64(int(1, 3600))],
      [RVM_TIME_ESTIMATION, b64(int(1, 3000))],
    ]);
  });

  it("prunes logged payloads older than 30 days", async () => {
    await handle.db.insert(parallaxMessages).values({
      vehicleId: "v1",
      rvm: RVM_TIME_ESTIMATION,
      payload: "old",
      receivedAt: new Date(Date.now() - 31 * 24 * 3600_000),
    });
    const store = new ParallaxStore(handle.db);
    await store.ingest("v1", { rvm: RVM_TIME_ESTIMATION, timestamp: at, payload: b64(int(1, 60)) });

    const logged = await handle.db.select({ payload: parallaxMessages.payload }).from(parallaxMessages);
    expect(logged.map((r) => r.payload)).toEqual([b64(int(1, 60))]);
  });
});
