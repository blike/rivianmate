/**
 * Records the history behind the mock's drive-home scene, so screenshots
 * can be taken without driving it first: the drive so far (from Lexington,
 * partway home), a home charge the night before, and Home as a saved
 * location with its rate. Then start the app with the scene:
 *
 *   DATABASE_URL=postgres://… pnpm --filter @rivianmate/server demo:scene
 *   MOCK_RIVIAN=1 MOCK_SCENE=drive-home pnpm dev
 *
 * Sign in to the mock once beforehand, so the app reconnects on start and
 * the mock picks the drive up where this leaves it. Meant for a demo
 * database: it replaces open drives and earlier demo charges.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import {
  chargingCurvePoints,
  chargingSessions,
  drives,
  locationPoints,
  savedLocations,
  vehicles,
} from '../src/db/schema.js';
import { MOCK_VEHICLE_ID, MOCK_VIN, driveHomeSoFar } from '../src/rivian/mock.js';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error('Set DATABASE_URL (e.g. postgres://rivianmate:…@localhost:5433/rivianmate).');
  process.exit(1);
}

/** Marks the charge this script records, to replace it on the next run. */
const DEMO_CHARGER = 'demo-scene';
const HOUR_MS = 3_600_000;

const { db, sql } = createDb(DATABASE_URL);
const now = Date.now();
const drive = driveHomeSoFar(now);
const home = drive.destination;

await db
  .insert(vehicles)
  .values({ id: MOCK_VEHICLE_ID, vin: MOCK_VIN, name: 'Mock R1S', model: 'R1S', modelYear: 2023 })
  .onConflictDoNothing();

const [existingHome] = await db
  .select()
  .from(savedLocations)
  .where(eq(savedLocations.isHome, true));
if (existingHome) {
  await db
    .update(savedLocations)
    .set({ ratePerKwh: 0.131 })
    .where(eq(savedLocations.id, existingHome.id));
} else {
  await db
    .insert(savedLocations)
    .values({ name: 'Home', lat: home.lat, lon: home.lon, isHome: true, ratePerKwh: 0.131 });
}

// Last night's charge: 12:00 to 4:39 AM in a time zone of the screenshot's
// choosing, about 31 hours before now (see the zone printed at the end).
const chargeStart = Math.round((now - 31 * HOUR_MS) / HOUR_MS) * HOUR_MS + 4_000;
const chargingSeconds = 4 * 3600 + 39 * 60 + 48;
const chargeEnd = chargeStart + chargingSeconds * 1000;
await db.delete(chargingSessions).where(eq(chargingSessions.chargerId, DEMO_CHARGER));
const [charge] = await db
  .insert(chargingSessions)
  .values({
    vehicleId: MOCK_VEHICLE_ID,
    startedAt: new Date(chargeStart),
    endedAt: new Date(chargeEnd),
    chargerId: DEMO_CHARGER,
    chargerType: 'wallbox',
    startSoc: 43.2,
    endSoc: 70,
    chargingSeconds,
    energyKwh: 31.8,
    packKwh: 30.6,
    thermalKwh: 1.2,
    rangeAddedKm: 144.8,
    avgPowerKw: 7.4,
    maxPowerKw: 7.4,
    currency: 'USD',
    lat: home.lat,
    lon: home.lon,
    isHomeCharger: true,
  })
  .returning({ id: chargingSessions.id });
// Rivian's graph: 32-minute bars at a steady 7.4 kW, the level rising evenly.
const BAR_MS = 32 * 60_000;
const bars = Math.ceil((chargeEnd - chargeStart) / BAR_MS);
await db.insert(chargingCurvePoints).values(
  Array.from({ length: bars + 1 }, (_, i) => {
    const ts = Math.min(chargeStart + i * BAR_MS, chargeEnd);
    return {
      sessionId: charge!.id,
      source: 'graph',
      ts: new Date(ts),
      powerKw: 7.4,
      soc: 43.2 + (26.8 * (ts - chargeStart)) / (chargeEnd - chargeStart),
    };
  }),
);

// The drive home so far, left open for the mock to carry on.
const open = await db
  .select({ id: drives.id })
  .from(drives)
  .where(and(eq(drives.vehicleId, MOCK_VEHICLE_ID), isNull(drives.endedAt)));
if (open.length > 0) {
  const ids = open.map((d) => d.id);
  await db.delete(locationPoints).where(inArray(locationPoints.driveId, ids));
  await db.delete(drives).where(inArray(drives.id, ids));
}
const first = drive.points[0]!;
const [driveRow] = await db
  .insert(drives)
  .values({
    vehicleId: MOCK_VEHICLE_ID,
    startedAt: drive.startedAt,
    startLat: first.lat,
    startLon: first.lon,
    startMileageM: drive.startMileageM,
    startBattery: drive.startBattery,
    batteryCapacityKwh: drive.batteryCapacityKwh,
    startRangeKm: drive.startBattery * 4.4,
    driveMode: 'everyday',
    destinationName: home.name,
    destinationLat: home.lat,
    destinationLon: home.lon,
    startPlace: 'Main Street, Lexington',
    startAddress: 'Main Street, Lexington, Illinois, United States',
  })
  .returning({ id: drives.id });
await db
  .insert(locationPoints)
  .values(drive.points.map((p) => ({ ...p, vehicleId: MOCK_VEHICLE_ID, driveId: driveRow!.id })));

await sql.end();

// Etc/GMT names count west as positive.
const offset = ((((-new Date(chargeStart).getUTCHours() + 12) % 24) + 24) % 24) - 12;
const zone = offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
console.log(
  `Recorded drive #${driveRow!.id} (${drive.points.length} points, started ${drive.startedAt.toISOString()}) and charge #${charge!.id}.`,
);
console.log(
  `The charge reads 12:00 – 4:39 AM in ${zone}. Start the app with MOCK_SCENE=drive-home now.`,
);
