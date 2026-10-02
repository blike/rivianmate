/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, runMigrations } from "../db/client.js";
import { drives, vehicles } from "../db/schema.js";
import { DrivePlaces, type ReverseGeocode } from "./drive-places.js";

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)("DrivePlaces with Postgres", () => {
  let handle: ReturnType<typeof createDb>;
  const drive = (startLat: number, endLat: number, ended = true) =>
    handle.db
      .insert(drives)
      .values({
        vehicleId: "v1",
        startedAt: new Date("2026-10-01T15:00:00Z"),
        endedAt: ended ? new Date("2026-10-01T15:20:00Z") : null,
        startLat,
        startLon: -117,
        endLat,
        endLon: -117,
      })
      .returning()
      .then((r) => r[0]!.id);
  const row = async (id: number) => (await handle.db.select().from(drives)).find((d) => d.id === id)!;

  beforeAll(async () => {
    await runMigrations(url!, join(here, "..", "..", "drizzle"));
    handle = createDb(url!);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE vehicles, geocode_cache RESTART IDENTITY CASCADE`;
    await handle.db.insert(vehicles).values({ id: "v1", vin: "VIN1" });
  });

  it("fills finished drives, looking each spot up once", async () => {
    const calls: number[] = [];
    const geocode: ReverseGeocode = async (lat) => {
      calls.push(lat);
      return lat === 34 ? null : { place: `Place ${lat}`, address: `Full ${lat}` };
    };
    const first = await drive(33, 34);
    const second = await drive(34, 33); // the same two spots, reversed
    const ongoing = await drive(35, 36, false);
    const places = new DrivePlaces(handle.db, geocode, () => {}, 0);
    await places.start();
    await places.idle();

    expect(calls.sort()).toEqual([33, 34]);
    const a = await row(first);
    expect([a.startPlace, a.startAddress, a.endPlace]).toEqual(["Place 33", "Full 33", null]);
    expect(a.placesCheckedAt).not.toBeNull();
    expect((await row(second)).endPlace).toBe("Place 33");
    expect((await row(ongoing)).placesCheckedAt).toBeNull();
  });

  it("names the start of a drive in progress, then the rest once it ends", async () => {
    const calls: number[] = [];
    const geocode: ReverseGeocode = async (lat) => {
      calls.push(lat);
      return { place: `Place ${lat}`, address: `Full ${lat}` };
    };
    const id = await drive(33, 34, false);
    const places = new DrivePlaces(handle.db, geocode, () => {}, 0);
    places.enqueue(id);
    await places.idle();
    let r = await row(id);
    expect([r.startPlace, r.endPlace, r.placesCheckedAt]).toEqual(["Place 33", null, null]);

    await handle.db.update(drives).set({ endedAt: new Date("2026-10-01T15:20:00Z") }).where(eq(drives.id, id));
    places.enqueue(id);
    await places.idle();
    r = await row(id);
    expect([r.startPlace, r.endPlace]).toEqual(["Place 33", "Place 34"]);
    expect(calls).toEqual([33, 34]); // the start came from cache
  });

  it("leaves a drive pending when the lookup service fails", async () => {
    const id = await drive(33, 34);
    const places = new DrivePlaces(handle.db, async () => {
      throw new Error("Nominatim HTTP 503");
    }, () => {}, 0);
    places.enqueue(id);
    await places.idle();
    expect((await row(id)).placesCheckedAt).toBeNull();
  });
});
