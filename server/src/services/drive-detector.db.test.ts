/**
 * Integration tests against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, runMigrations } from "../db/client.js";
import { drives, locationPoints, vehicles } from "../db/schema.js";
import type { VehicleState } from "../rivian/types.js";
import { DriveDetector } from "./drive-detector.js";

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)("DriveDetector with Postgres", () => {
  let handle: ReturnType<typeof createDb>;
  let clock = 0;
  const at = (iso: string) => Date.parse(iso);

  /** Full state as the monitor passes it, every value stamped by Rivian at `stamp`. */
  const state = (gear: string, stamp: string, extra: { km?: number; soc?: number; range?: number } = {}): VehicleState => {
    const v = (value: string | number) => ({ value, timeStamp: stamp });
    return {
      gearStatus: v(gear),
      powerState: v(gear === "park" ? "ready" : "go"),
      gnssSpeed: v(gear === "park" ? 0 : 15),
      vehicleMileage: v((extra.km ?? 1000) * 1000),
      batteryLevel: v(extra.soc ?? 70),
      distanceToEmpty: v(extra.range ?? 375),
      batteryCapacity: v(111),
      driveMode: v("everyday"),
      gnssLocation: { latitude: 33.07, longitude: -117.26, timeStamp: stamp },
    };
  };
  // The parked grace runs on real timers, shortened; times come from `clock`.
  const detector = () => new DriveDetector(handle.db, () => {}, () => clock, 50);
  const rows = () => handle.db.select().from(drives).orderBy(drives.id);
  /** Waits for the park timer to end every drive. */
  const settle = () =>
    vi.waitFor(async () => expect((await rows()).every((r) => r.endedAt)).toBe(true), { timeout: 2000 });

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

  it("times a drive by Rivian's stamps, ending when it parked rather than 3 minutes later", async () => {
    const d = detector();
    clock = at("2026-10-01T15:00:05Z"); // heard 5 s after the gear change
    await d.onState("v1", state("drive", "2026-10-01T15:00:00Z", { km: 1000, soc: 70, range: 375 }));
    clock = at("2026-10-01T15:20:02Z");
    await d.onState("v1", state("park", "2026-10-01T15:20:00Z", { km: 1018.5, soc: 66, range: 357 }));
    await settle();

    const [drive] = await rows();
    expect(drive!.startedAt.toISOString()).toBe("2026-10-01T15:00:00.000Z");
    expect(drive!.endedAt?.toISOString()).toBe("2026-10-01T15:20:00.000Z");
    expect(drive!.distanceKm).toBeCloseTo(18.5);
    expect([drive!.startRangeKm, drive!.endRangeKm, drive!.endBattery]).toEqual([375, 357, 66]);
    expect(drive!.driveMode).toBe("everyday");
  });

  it("ends at once when the parked state arrives late (e.g. after the host slept)", async () => {
    const d = detector();
    clock = at("2026-10-01T14:49:00Z");
    await d.onState("v1", state("drive", "2026-10-01T14:49:00Z"));
    clock = at("2026-10-01T15:04:30Z"); // asleep until now; parked at 14:55
    await d.onState("v1", state("park", "2026-10-01T14:55:00Z"));
    await settle();

    const [drive] = await rows();
    expect(drive!.endedAt?.toISOString()).toBe("2026-10-01T14:55:00.000Z");
  });

  it("continues a drive still going across a restart, and closes a stale one", async () => {
    const [ongoing] = await handle.db
      .insert(drives)
      .values({ vehicleId: "v1", startedAt: new Date("2026-10-01T15:00:00Z"), startMileageM: 1_000_000 })
      .returning();
    await handle.db.insert(locationPoints).values({
      vehicleId: "v1", driveId: ongoing!.id, ts: new Date("2026-10-01T15:10:00Z"), lat: 33.07, lon: -117.26,
    });

    clock = at("2026-10-01T15:12:00Z");
    const d = detector();
    await d.onState("v1", state("drive", "2026-10-01T15:12:00Z", { km: 1012 }));
    expect(await rows()).toHaveLength(1);
    clock = at("2026-10-01T15:30:00Z");
    await d.onState("v1", state("park", "2026-10-01T15:30:00Z", { km: 1020 }));
    await settle();
    const [resumed] = await rows();
    expect(resumed!.distanceKm).toBeCloseTo(20);

    // A drive whose last reading is an hour old is over: closed at that reading.
    const [stale] = await handle.db
      .insert(drives)
      .values({ vehicleId: "v1", startedAt: new Date("2026-10-01T16:00:00Z") })
      .returning();
    await handle.db.insert(locationPoints).values({
      vehicleId: "v1", driveId: stale!.id, ts: new Date("2026-10-01T16:20:00Z"), lat: 33.08, lon: -117.27,
    });
    clock = at("2026-10-01T17:20:00Z");
    await detector().onState("v1", state("drive", "2026-10-01T17:20:00Z"));
    const all = await rows();
    expect(all.find((r) => r.id === stale!.id)!.endedAt?.toISOString()).toBe("2026-10-01T16:20:00.000Z");
    expect(all).toHaveLength(3); // and a new drive started
  });

  it("records the navigation destination on the drive", async () => {
    const d = detector();
    const destination = { name: "100 Main St", lat: 32.88, lon: -117.22 };
    await d.noteDestination("v1", destination); // set while parked
    clock = at("2026-10-01T15:00:00Z");
    await d.onState("v1", state("drive", "2026-10-01T15:00:00Z"));
    let [drive] = await rows();
    expect(drive!.destinationName).toBe("100 Main St");

    await d.noteDestination("v1", { name: "Elsewhere", lat: 33, lon: -117 }); // rerouted
    [drive] = await rows();
    expect([drive!.destinationName, drive!.destinationLat]).toEqual(["Elsewhere", 33]);
  });
});
