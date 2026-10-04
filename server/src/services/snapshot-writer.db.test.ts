/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, runMigrations } from "../db/client.js";
import { drives, locationPoints, vehicles } from "../db/schema.js";
import type { VehicleState } from "../rivian/types.js";
import { SnapshotWriter } from "./snapshot-writer.js";

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)("SnapshotWriter location points with Postgres", () => {
  let handle: ReturnType<typeof createDb>;
  let clock = 0;

  /** A fix at `fix`, with speed/altitude stamped at `readings` (default: with the fix). */
  const state = (fix: string, lat: number, readings = fix): VehicleState => ({
    gnssLocation: { latitude: lat, longitude: -116.05, timeStamp: fix },
    gnssSpeed: { value: 20, timeStamp: readings },
    gnssAltitude: { value: 600, timeStamp: readings },
  });
  const points = () => handle.db.select().from(locationPoints).orderBy(locationPoints.ts);

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

  it("files a fix delivered late under the drive it was taken on", async () => {
    const [earlier] = await handle.db
      .insert(drives)
      .values({
        vehicleId: "v1",
        startedAt: new Date("2026-10-04T16:16:00Z"),
        endedAt: new Date("2026-10-04T16:42:42Z"),
      })
      .returning();
    const [current] = await handle.db
      .insert(drives)
      .values({ vehicleId: "v1", startedAt: new Date("2026-10-04T16:51:21Z") })
      .returning();
    const writer = new SnapshotWriter(handle.db, () => clock);
    writer.setCurrentDrive("v1", current!.id);

    clock = Date.parse("2026-10-04T17:09:00Z");
    await writer.onState("v1", state("2026-10-04T16:30:00Z", 34.01)); // from the earlier drive
    await writer.onState("v1", state("2026-10-04T16:45:37Z", 34.02)); // parked in between
    await writer.onState("v1", state("2026-10-04T17:08:59Z", 34.03)); // live

    expect((await points()).map((p) => p.driveId)).toEqual([earlier!.id, null, current!.id]);
  });

  it("keeps speed and altitude only when stamped with the fix", async () => {
    const writer = new SnapshotWriter(handle.db, () => clock);
    clock = Date.parse("2026-10-04T17:09:00Z");
    await writer.onState("v1", state("2026-10-04T16:30:00Z", 34.01, "2026-10-04T17:08:50Z"));
    await writer.onState("v1", state("2026-10-04T17:08:59Z", 34.03));

    const [late, live] = await points();
    expect([late!.speedKmh, late!.altitude]).toEqual([null, null]);
    expect([live!.speedKmh, live!.altitude]).toEqual([72, 600]);
  });

  it("stores Rivian's last fix once, even when a restart sees it again", async () => {
    clock = Date.parse("2026-10-04T10:16:00Z");
    await new SnapshotWriter(handle.db, () => clock).onState("v1", state("2026-10-03T21:37:03Z", 34.0));
    await new SnapshotWriter(handle.db, () => clock).onState("v1", state("2026-10-03T21:37:03Z", 34.0));
    expect(await points()).toHaveLength(1);
  });

  it("ignores the 0,0 Rivian sends without a fix", async () => {
    clock = Date.parse("2026-10-04T17:09:00Z");
    await new SnapshotWriter(handle.db, () => clock).onState("v1", {
      gnssLocation: { latitude: 0, longitude: 0, timeStamp: "2026-10-04T17:08:59Z" },
    });
    expect(await points()).toHaveLength(0);
  });
});
