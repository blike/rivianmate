/**
 * Records the history behind the mock's drive-home scene, so screenshots
 * can be taken without driving it first: the drive so far (from Lexington,
 * partway home), a home charge the night before, the rest of the week's
 * drives and charges, and Home as a saved location with its rate. Then
 * start the app with the scene:
 *
 *   DATABASE_URL=postgres://… pnpm --filter @rivianmate/server demo:scene
 *   MOCK_RIVIAN=1 MOCK_SCENE=drive-home pnpm dev
 *
 * Sign in to the mock once beforehand, so the app reconnects on start and
 * the mock picks the drive up where this leaves it. Meant for a demo
 * database: it replaces open drives, the week's finished drives, and
 * earlier demo charges.
 *
 * This week then reads 272 mi, 26 drives, 2.84 mi/kWh and 97 kWh charged.
 * The drive home carries on at 56 mph, so take screenshots within about half
 * a minute of starting the app, or run this again.
 */
import { and, eq, gte, inArray, isNotNull, isNull, lt, sql as raw } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import {
  chargingCurvePoints,
  chargingSessions,
  drives,
  locationPoints,
  parallaxLatest,
  savedLocations,
  vehicles,
} from '../src/db/schema.js';
import { MOCK_VEHICLE_ID, MOCK_VIN, driveHomeSoFar } from '../src/rivian/mock.js';
import { coldWeather } from '../src/rivian/parallax/index.js';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error('Set DATABASE_URL (e.g. postgres://rivianmate:…@localhost:5433/rivianmate).');
  process.exit(1);
}

/** Marks the charge this script records, to replace it on the next run. */
const DEMO_CHARGER = 'demo-scene';
const HOUR_MS = 3_600_000;
const LAST_CHARGE_KWH = 31.8;

const { db, sql } = createDb(DATABASE_URL);
const now = Date.now();
const drive = driveHomeSoFar(now);
const home = drive.destination;

await db
  .insert(vehicles)
  .values({ id: MOCK_VEHICLE_ID, vin: MOCK_VIN, name: 'Shadow', model: 'R1S', modelYear: 2023 })
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
    energyKwh: LAST_CHARGE_KWH,
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

// The rest of the week, in the same zone as the charge: today began 24 hours
// after it did. The drive home counts toward the week's figures, so the
// other drives make up the difference.
const DAY_MS = 24 * HOUR_MS;
const MI = 1.609344;
const WEEK = { miles: 272, miPerKwh: 2.84, chargedKwh: 97 };
const todayStart = chargeStart - 4_000 + DAY_MS;
const weekStart = todayStart - 6 * DAY_MS;
// Aimed a little short, as the drive home adds to it by the time the page loads.
const restKm = (WEEK.miles - 0.25) * MI - drive.distanceM / 1000;
const restKwh =
  WEEK.miles / WEEK.miPerKwh -
  ((drive.startBattery - drive.battery) / 100) * drive.batteryCapacityKwh;

// Six days before today, unevenly: [hour started, share of the week's miles].
const days: [number, number][][] = [
  [
    [7.6, 11.9],
    [12.2, 4.6],
    [17.4, 14.6],
    [19.9, 7.3],
  ],
  [
    [7.3, 11.5],
    [9.1, 4.7],
    [12.6, 14.1],
    [16.8, 7.3],
    [18.7, 14.6],
  ],
  [
    [8.2, 14.6],
    [13.5, 6.7],
    [18.1, 10.5],
  ],
  [
    [9.4, 4.9],
    [11.1, 31.9],
    [15.2, 17.8],
    [20.3, 6.7],
  ],
  [
    [10.6, 8.7],
    [14.4, 9.9],
    [17.8, 6.2],
  ],
  [
    [7.4, 9.7],
    [8.9, 3.8],
    [12.1, 13.0],
    [13.7, 7.0],
    [17.2, 14.0],
    [19.4, 6.5],
  ],
];
const trips = [
  ['Home', 'Main Street, Normal'],
  ['Main Street, Normal', 'Constitution Trail'],
  ['Constitution Trail', 'Home'],
  ['Home', 'Veterans Parkway, Bloomington'],
  ['Veterans Parkway, Bloomington', 'Home'],
  ['Home', 'Uptown Normal'],
  ['Uptown Normal', 'College Avenue, Normal'],
  ['College Avenue, Normal', 'Home'],
] as const;
// Efficiency varies a little from drive to drive.
const spread = [1.06, 0.94, 1.02, 0.97, 1.09, 0.91, 1.0, 1.04, 0.95, 1.03];

const shares = days.flat().map(([, share]) => share);
const totalShare = shares.reduce((a, b) => a + b, 0);
const weights = shares.map((share, i) => share / spread[i % spread.length]!);
const totalWeight = weights.reduce((a, b) => a + b, 0);

const old = await db
  .select({ id: drives.id })
  .from(drives)
  .where(
    and(
      eq(drives.vehicleId, MOCK_VEHICLE_ID),
      isNotNull(drives.endedAt),
      gte(drives.startedAt, new Date(weekStart - DAY_MS)),
    ),
  );
if (old.length > 0) {
  const ids = old.map((d) => d.id);
  await db.delete(locationPoints).where(inArray(locationPoints.driveId, ids));
  await db.delete(drives).where(inArray(drives.id, ids));
}

// Mileage counts back from the drive home's start; the level restarts after each charge.
let mileageM = drive.startMileageM;
const rows = days
  .flatMap((day, d) => day.map(([hour]) => weekStart + d * DAY_MS + hour * HOUR_MS))
  .map((startedAt, i) => {
    const km = (restKm * shares[i]!) / totalShare;
    return { i, startedAt, km, kwh: (restKwh * weights[i]!) / totalWeight };
  })
  .reverse()
  .map((r) => {
    const endMileageM = mileageM;
    mileageM -= r.km * 1000 + 400;
    return { ...r, startMileageM: endMileageM - r.km * 1000, endMileageM };
  })
  .reverse();
let level = 78;
await db.insert(drives).values(
  rows.map((r) => {
    const drop = (r.kwh / drive.batteryCapacityKwh) * 100;
    if (level - drop < 35) level = 80;
    const startBattery = level;
    level -= drop;
    const [from, to] = trips[r.i % trips.length]!;
    const lat = home.lat + (r.i % 7) * 0.004;
    const lon = home.lon + (r.i % 5) * 0.005;
    return {
      vehicleId: MOCK_VEHICLE_ID,
      startedAt: new Date(r.startedAt),
      endedAt: new Date(r.startedAt + (6 + r.km * 1.15) * 60_000),
      startLat: lat,
      startLon: lon,
      endLat: lat + 0.01,
      endLon: lon - 0.01,
      distanceKm: r.km,
      startMileageM: r.startMileageM,
      endMileageM: r.endMileageM,
      startBattery,
      endBattery: level,
      batteryCapacityKwh: drive.batteryCapacityKwh,
      startRangeKm: startBattery * 5.31,
      endRangeKm: level * 5.31,
      driveMode: 'everyday',
      startPlace: from,
      endPlace: to,
      placesCheckedAt: new Date(now),
      weatherCheckedAt: new Date(now),
    };
  }),
);

// Three more nights charging at home, to make up the week's total.
const nights: [number, number][] = [
  [5, 24.6],
  [3, 18.9],
  [2, 21.7],
];
const nightsKwh = nights.reduce((a, [, kwh]) => a + kwh, 0);
await db.insert(chargingSessions).values(
  nights.map(([daysAgo, share]) => {
    const kwh = (share * (WEEK.chargedKwh - LAST_CHARGE_KWH)) / nightsKwh;
    const startedAt = todayStart - daysAgo * DAY_MS + HOUR_MS / 2;
    const seconds = Math.round((kwh / 7.4) * 3600);
    const added = (kwh / drive.batteryCapacityKwh) * 100;
    return {
      vehicleId: MOCK_VEHICLE_ID,
      startedAt: new Date(startedAt),
      endedAt: new Date(startedAt + seconds * 1000),
      chargerId: DEMO_CHARGER,
      chargerType: 'wallbox' as const,
      startSoc: 70 - added,
      endSoc: 70,
      chargingSeconds: seconds,
      energyKwh: kwh,
      rangeAddedKm: added * 5.31,
      avgPowerKw: 7.4,
      maxPowerKw: 7.4,
      currency: 'USD',
      lat: home.lat,
      lon: home.lon,
      isHomeCharger: true,
    };
  }),
);

// The mock's imported public charges fall in this week; move them before it.
await db
  .update(chargingSessions)
  .set({
    startedAt: raw`${chargingSessions.startedAt} - interval '9 days'`,
    endedAt: raw`${chargingSessions.endedAt} - interval '9 days'`,
  })
  .where(
    and(
      eq(chargingSessions.vehicleId, MOCK_VEHICLE_ID),
      eq(chargingSessions.source, 'rivian'),
      gte(chargingSessions.startedAt, new Date(weekStart)),
      lt(chargingSessions.startedAt, new Date(now)),
    ),
  );

// The scene isn't cold; forget the report from signing in.
await db
  .delete(parallaxLatest)
  .where(
    and(eq(parallaxLatest.vehicleId, MOCK_VEHICLE_ID), eq(parallaxLatest.rvm, coldWeather.rvm)),
  );

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
