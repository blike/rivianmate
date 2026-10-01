/** Integration test against a real Postgres; skipped unless TEST_DATABASE_URL is set. */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, runMigrations } from "../db/client.js";
import { chargingCurvePoints, chargingSessions, vehicles } from "../db/schema.js";
import type { RivianApi } from "../rivian/client.js";
import { ChargeHistoryImporter } from "./charge-history.js";

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)("ChargeHistoryImporter curve sync with Postgres", () => {
  let handle: ReturnType<typeof createDb>;

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

  it("imports a session charged while away and fills its curve without touching existing points", async () => {
    const api = {
      getChargeHistory: async () => [
        {
          transactionId: "tx-1",
          startInstant: "2026-09-30T20:00:00Z",
          endInstant: "2026-09-30T21:00:00Z",
          totalEnergyKwh: 30,
          rangeAddedKm: 100,
          vendor: null,
          paidTotal: null,
          chargerType: null,
          currencyCode: null,
          city: null,
          vehicleId: "v1",
          isPublic: false,
          isHomeCharger: true,
        },
      ],
      getLatestSessionCurve: async () => [
        { ts: "2026-09-30T20:00:00Z", powerKw: 9 },
        { ts: "2026-09-30T20:30:00Z", powerKw: 9.5 },
        { ts: "2026-09-30T21:00:00Z", powerKw: 3 },
        { ts: "2026-09-30T23:00:00Z", powerKw: 1 }, // outside every session: dropped
      ],
    } as unknown as RivianApi;

    const importer = new ChargeHistoryImporter(handle.db, api, () => ["v1"]);
    await importer.run();
    const [session] = await handle.db.select().from(chargingSessions);
    expect(session!.source).toBe("rivian");

    // A live point that already exists keeps its SoC.
    await handle.db
      .delete(chargingCurvePoints)
      .where(eq(chargingCurvePoints.ts, new Date("2026-09-30T20:30:00Z")));
    await handle.db.insert(chargingCurvePoints).values({
      sessionId: session!.id,
      ts: new Date("2026-09-30T20:30:00Z"),
      powerKw: 9.4,
      soc: 61,
    });
    await importer.run();

    const points = await handle.db
      .select()
      .from(chargingCurvePoints)
      .where(eq(chargingCurvePoints.sessionId, session!.id))
      .orderBy(chargingCurvePoints.ts);
    expect(points.map((p) => p.powerKw)).toEqual([9, 9.4, 3]);
    expect(points[1]!.soc).toBe(61);
    expect(await handle.db.select().from(chargingSessions)).toHaveLength(1);
  });
});
