/** Integration test against a real Postgres; skipped unless TEST_DATABASE_URL is set. */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, runMigrations } from "../db/client.js";
import { chargingSessions, vehicleStateSnapshots, vehicles } from "../db/schema.js";
import type { RivianApi } from "../rivian/client.js";
import { ChargeHistoryImporter } from "./charge-history.js";

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)("ChargeHistoryImporter with Postgres", () => {
  let handle: ReturnType<typeof createDb>;

  beforeAll(async () => {
    await runMigrations(url!, join(here, "..", "..", "drizzle"));
    handle = createDb(url!);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE charging_curve_points, charging_sessions, vehicle_state_snapshots, vehicles RESTART IDENTITY CASCADE`;
    await handle.db.insert(vehicles).values({ id: "v1", vin: "VIN1" });
  });

  // Last night's real plug-in (UTC): plugged 00:34, charged 06:59→12:12, unplugged 12:31.
  const summary = {
    transactionId: "tx-night",
    startInstant: "2026-10-01T00:34:54.722Z",
    endInstant: "2026-10-01T12:31:09.091Z",
    totalEnergyKwh: 35.7,
    rangeAddedKm: 162,
    vendor: "RIVIAN",
    paidTotal: null,
    chargerType: null,
    currencyCode: null,
    city: null,
    vehicleId: "v1",
    isPublic: false,
    isHomeCharger: true,
  };
  const historyApi = {
    getChargeHistory: async () => [summary],
  } as unknown as RivianApi;

  it("takes Rivian's plug-in span when linking a session it recorded part of", async () => {
    await handle.db.insert(chargingSessions).values({
      vehicleId: "v1",
      startedAt: new Date("2026-10-01T04:40:39Z"), // started watching mid plug-in
      endedAt: new Date("2026-10-01T12:31:00Z"),
      chargingSeconds: 18779,
      startSoc: 39.7,
      endSoc: 70,
    });
    await new ChargeHistoryImporter(handle.db, historyApi, () => ["v1"]).run();

    const rows = await handle.db.select().from(chargingSessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("live+rivian");
    expect(rows[0]!.startedAt.toISOString()).toBe("2026-10-01T00:34:54.722Z");
    expect(rows[0]!.endedAt?.toISOString()).toBe("2026-10-01T12:31:09.091Z");
    expect(rows[0]!.chargingSeconds).toBe(18779);
    expect(rows[0]!.energyKwh).toBe(35.7);
  });

  it("fills charging time and SOC for an imported session from recorded vehicle states", async () => {
    const reading = (ts: string, chargerState: [string, string], soc: [number, string]) => ({
      vehicleId: "v1",
      ts: new Date(ts),
      data: {
        chargerState: { value: chargerState[0], timeStamp: chargerState[1] },
        batteryLevel: { value: soc[0], timeStamp: soc[1] },
      },
    });
    await handle.db.insert(vehicleStateSnapshots).values([
      reading("2026-10-01T04:40:39Z", ["charging_scheduled", "2026-10-01T01:57:02.944Z"], [39.7, "2026-10-01T02:01:38.478Z"]),
      reading("2026-10-01T07:03:32Z", ["charging_active", "2026-10-01T06:59:44.969Z"], [39.8, "2026-10-01T07:03:22.198Z"]),
      // Row stamped before the reading inside it, as seen in real data.
      reading("2026-10-01T11:52:22Z", ["charging_complete", "2026-10-01T12:12:43.913Z"], [70, "2026-10-01T12:12:41.947Z"]),
    ]);
    await new ChargeHistoryImporter(handle.db, historyApi, () => ["v1"]).run();

    const [row] = await handle.db.select().from(chargingSessions);
    expect(row!.source).toBe("rivian");
    expect(row!.chargingSeconds).toBe(18779); // 5h 12m 59s
    expect([row!.startSoc, row!.endSoc]).toEqual([39.7, 70]);
  });
});
