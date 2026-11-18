/**
 * Records the history behind the mock's drive-home scene, so screenshots
 * can be taken without driving it first: the drive so far (from Lexington,
 * partway home) with the pack's temperatures along it, a home charge the night
 * before with the pack warming through it, the rest of the week's drives and
 * charges, and Home as a saved location with its rate. Then start the app with
 * the scene:
 *
 *   DATABASE_URL=postgres://… pnpm --filter @rivianmate/server demo:scene
 *   MOCK_RIVIAN=1 MOCK_SCENE=drive-home pnpm dev
 *
 * Sign in to the mock once beforehand, so the app reconnects on start and
 * the mock picks the drive up where this leaves it. Meant for a demo
 * database: it replaces all the mock's drives, earlier demo charges, and
 * the state history since the day before the week. It also makes a trip of
 * the latest few drives and charges.
 *
 * Behind the week are about 1,000 days of made-up drives and charges back to
 * delivery (src/rivian/mock-history.ts): ~34,000 mi with weekends away and
 * fast charges on the way, so History's long periods have month bars, a
 * year-spanning axis and seasons. The vehicle-state strip and battery line
 * are drawn for the week only; before it, state history is live-only.
 *
 * This week then reads 272 mi, 26 drives, 2.84 mi/kWh and 97 kWh charged.
 * The drive home carries on at 56 mph, so take screenshots within about half
 * a minute of starting the app, or run this again.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql as raw } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import {
  chargingCurvePoints,
  chargingSessions,
  drives,
  locationPoints,
  parallaxLatest,
  savedLocations,
  stateChanges,
  stateHeartbeats,
  tripActivities,
  trips as tripsTable,
  vehicles,
} from '../src/db/schema.js';
import { pastHistory, routeOf } from '../src/rivian/mock-history.js';
import { MOCK_VEHICLE_ID, MOCK_VIN, driveHomeSoFar } from '../src/rivian/mock.js';
import { coldWeather } from '../src/rivian/parallax/index.js';
import { HistoryKeys } from '../src/services/history-keys.js';
import { HEARTBEAT_MS } from '../src/services/state-history.js';

const DEMO_TRIP = 'Weekend in Bloomington';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error('Set DATABASE_URL (e.g. postgres://rivianmate:…@localhost:5433/rivianmate).');
  process.exit(1);
}

/** Marks the charges this script records, to replace them on the next run. */
const DEMO_CHARGER = 'demo-scene';
const HOUR_MS = 3_600_000;
const LAST_CHARGE_KWH = 31.8;
/** About two and three-quarter years of history before the week: past 730 days, for month bars. */
const HISTORY_DAYS = 1000;
/** The odometer at delivery: 10 mi. */
const DELIVERY_MILEAGE_M = 16_093;

/** Where the weekends away went. */
const CITIES: Record<string, { lat: number; lon: number }> = {
  Chicago: { lat: 41.8781, lon: -87.6298 },
  Springfield: { lat: 39.7817, lon: -89.6501 },
  'St. Louis': { lat: 38.627, lon: -90.1994 },
  Champaign: { lat: 40.1164, lon: -88.2434 },
  Peoria: { lat: 40.6936, lon: -89.589 },
  Galena: { lat: 42.4167, lon: -90.429 },
};

/**
 * A place's coordinates: a city away, a rest stop halfway to it, or
 * somewhere around home, the same spot for the same name every time.
 */
function coordinates(name: string, home: { lat: number; lon: number }) {
  if (name === 'Home') return home;
  if (CITIES[name]) return CITIES[name];
  const toward = routeOf(name);
  if (toward) {
    const city = CITIES[toward] ?? home;
    return { lat: (home.lat + city.lat) / 2, lon: (home.lon + city.lon) / 2 };
  }
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    lat: home.lat + ((hash % 61) - 30) * 0.0008,
    lon: home.lon + (((hash >>> 8) % 61) - 30) * 0.001,
  };
}

/** Rows in batches, under Postgres's limit on parameters per statement. */
function chunks<T>(rows: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, i) =>
    rows.slice(i * size, (i + 1) * size),
  );
}

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
      source: 'graph' as const,
      ts: new Date(ts),
      powerKw: 7.4,
      soc: 43.2 + (26.8 * (ts - chargeStart)) / (chargeEnd - chargeStart),
    };
  }),
);

// The pack's temperatures through that charge: cold overnight, warming as it charges.
const TEMPERATURE_FIELDS = ['batteryTempAvg', 'batteryTempMax', 'batteryTempMin'] as const;
const TEMPERATURE_STEP_MS = 6 * 60_000;
const keys = new HistoryKeys(db);
const vehicleSeq = (await keys.vehicleSeq(MOCK_VEHICLE_ID))!;
const temperatureIds = await keys.fieldIds(TEMPERATURE_FIELDS);
// Replaced on every run, like the charge it belongs to.
await db
  .delete(stateChanges)
  .where(
    and(
      eq(stateChanges.vehicleSeq, vehicleSeq),
      inArray(stateChanges.fieldId, [...temperatureIds.values()]),
      gte(stateChanges.at, new Date(chargeStart - HOUR_MS)),
      lte(stateChanges.at, new Date(chargeEnd + HOUR_MS)),
    ),
  );
const tenths = (celsius: number) => Math.round(celsius * 10) / 10;
await db.insert(stateChanges).values(
  Array.from(
    { length: Math.floor((chargeEnd - chargeStart) / TEMPERATURE_STEP_MS) + 1 },
    (_, i) => {
      const at = new Date(chargeStart + i * TEMPERATURE_STEP_MS);
      // Warming quickly at first, then levelling off toward 24 °C.
      const mean = 14 + 10 * Math.sqrt((at.getTime() - chargeStart) / (chargeEnd - chargeStart));
      return (
        [
          ['batteryTempAvg', mean],
          ['batteryTempMax', mean + 2.4],
          ['batteryTempMin', mean - 1.9],
        ] as const
      ).map(([field, celsius]) => ({
        vehicleSeq,
        fieldId: temperatureIds.get(field)!,
        at,
        num: tenths(celsius),
      }));
    },
  ).flat(),
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

// The pack warming over the drive so far, ending where the mock's own frames carry on.
const TEMP_FIELDS = ['batteryTempAvg', 'batteryTempMin', 'batteryTempMax'] as const;
/** From 70 °F to the 75 °F the mock reports. */
const TEMP_START = { batteryTempAvg: 21, batteryTempMin: 20, batteryTempMax: 22 };
const TEMP_END = { batteryTempAvg: 24, batteryTempMin: 22, batteryTempMax: 27 };
const seq = await keys.vehicleSeq(MOCK_VEHICLE_ID);
const tempFields = await keys.fieldIds(TEMP_FIELDS);
// Clear the drive's readings (not the charge's above), so a re-run starts clean.
await db
  .delete(stateChanges)
  .where(
    and(
      eq(stateChanges.vehicleSeq, seq!),
      inArray(stateChanges.fieldId, [...tempFields.values()]),
      gte(stateChanges.at, drive.startedAt),
      lte(stateChanges.at, new Date(now)),
    ),
  );
const TEMP_EVERY_MS = 2 * 60_000;
const tempSpan = now - drive.startedAt.getTime();
const tempSteps = Math.max(1, Math.round(tempSpan / TEMP_EVERY_MS));
const tenth = (n: number) => Math.round(n * 10) / 10;
await db
  .insert(stateChanges)
  .values(
    Array.from({ length: tempSteps + 1 }, (_, i) => {
      const at = new Date(drive.startedAt.getTime() + (i * tempSpan) / tempSteps);
      const along = i / tempSteps;
      return TEMP_FIELDS.map((field) => ({
        vehicleSeq: seq!,
        fieldId: tempFields.get(field)!,
        at,
        num: tenth(TEMP_START[field] + (TEMP_END[field] - TEMP_START[field]) * along),
      }));
    }).flat(),
  )
  .onConflictDoUpdate({
    target: [stateChanges.vehicleSeq, stateChanges.fieldId, stateChanges.at],
    set: { num: raw`excluded.num` },
  });

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

// Every finished drive goes: the scene writes the vehicle's whole history.
const finishedDrives = db
  .select({ id: drives.id })
  .from(drives)
  .where(and(eq(drives.vehicleId, MOCK_VEHICLE_ID), isNotNull(drives.endedAt)));
await db.delete(locationPoints).where(inArray(locationPoints.driveId, finishedDrives));
await db
  .delete(drives)
  .where(and(eq(drives.vehicleId, MOCK_VEHICLE_ID), isNotNull(drives.endedAt)));

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
// Three more nights charging at home, to make up the week's total.
const nights: [number, number][] = [
  [5, 24.6],
  [3, 18.9],
  [2, 21.7],
];
const nightsKwh = nights.reduce((a, [, kwh]) => a + kwh, 0);
const nightCharges = nights.map(([daysAgo, share]) => {
  const kwh = (share * (WEEK.chargedKwh - LAST_CHARGE_KWH)) / nightsKwh;
  return {
    kwh,
    startedAt: todayStart - daysAgo * DAY_MS + HOUR_MS / 2,
    seconds: Math.round((kwh / 7.4) * 3600),
    added: (kwh / drive.batteryCapacityKwh) * 100,
    startSoc: 0,
    endSoc: 0,
  };
});

// The level through the week, in time order: each drive starts where the last
// drive or charge left it. Last night's charge ends at 70%, as recorded above.
const WEEK_START_LEVEL = 78;
const levels = new Map<number, { start: number; end: number }>();
{
  let level = WEEK_START_LEVEL;
  const events = [
    ...rows.map((r) => ({ at: r.startedAt, drive: r })),
    ...nightCharges.map((c) => ({ at: c.startedAt, night: c })),
    { at: chargeStart, last: true },
  ].sort((a, b) => a.at - b.at);
  for (const e of events) {
    if ('drive' in e) {
      const start = level;
      level -= (e.drive.kwh / drive.batteryCapacityKwh) * 100;
      levels.set(e.drive.i, { start, end: level });
    } else if ('night' in e) {
      e.night.startSoc = level;
      level += e.night.added;
      e.night.endSoc = level;
    } else {
      level = 70;
    }
  }
}

await db.insert(drives).values(
  rows.map((r) => {
    const { start: startBattery, end: level } = levels.get(r.i)!;
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

await db.insert(chargingSessions).values(
  nightCharges.map(({ kwh, startedAt, seconds, added, startSoc, endSoc }) => {
    return {
      vehicleId: MOCK_VEHICLE_ID,
      startedAt: new Date(startedAt),
      endedAt: new Date(startedAt + seconds * 1000),
      chargerId: DEMO_CHARGER,
      chargerType: 'wallbox' as const,
      startSoc,
      endSoc,
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

// The years before: from delivery to the day before the week, left empty so
// the rolling week never reaches into them.
const historyTo = weekStart - DAY_MS;
const past = pastHistory({
  from: historyTo - HISTORY_DAYS * DAY_MS,
  to: historyTo,
  startMileageM: DELIVERY_MILEAGE_M,
  endMileageM: rows[0]!.startMileageM,
  capacityKwh: drive.batteryCapacityKwh,
  endBattery: WEEK_START_LEVEL,
});
const placeAt = (name: string) => coordinates(name, home);
for (const chunk of chunks(past.drives, 500)) {
  await db.insert(drives).values(
    chunk.map((d) => {
      const start = placeAt(d.from);
      const end = placeAt(d.to);
      return {
        vehicleId: MOCK_VEHICLE_ID,
        startedAt: new Date(d.startedAt),
        endedAt: new Date(d.endedAt),
        startLat: start.lat,
        startLon: start.lon,
        endLat: end.lat,
        endLon: end.lon,
        distanceKm: d.km,
        startMileageM: d.startMileageM,
        endMileageM: d.endMileageM,
        startBattery: d.startBattery,
        endBattery: d.endBattery,
        batteryCapacityKwh: drive.batteryCapacityKwh,
        startRangeKm: d.startBattery * 5.31,
        endRangeKm: d.endBattery * 5.31,
        driveMode: d.roadTrip ? 'conserve' : 'everyday',
        startPlace: d.from,
        endPlace: d.to,
        placesCheckedAt: new Date(now),
        avgOutsideTempC: d.tempC,
        minOutsideTempC: d.tempC - 2,
        maxOutsideTempC: d.tempC + 2,
        weatherCheckedAt: new Date(now),
        driverSource: 'none' as const,
      };
    }),
  );
}
for (const chunk of chunks(past.charges, 500)) {
  await db.insert(chargingSessions).values(
    chunk.map((c) => {
      const at = c.home ? home : placeAt(c.city ?? 'Home');
      return {
        vehicleId: MOCK_VEHICLE_ID,
        startedAt: new Date(c.startedAt),
        endedAt: new Date(c.endedAt),
        chargerId: DEMO_CHARGER,
        chargerType: c.home ? ('wallbox' as const) : ('rivian_charger' as const),
        isRivianCharger: !c.home,
        isPublic: !c.home,
        isHomeCharger: c.home,
        vendor: c.home ? null : 'Rivian Adventure Network',
        city: c.city,
        startSoc: c.startSoc,
        endSoc: c.endSoc,
        chargingSeconds: Math.round((c.endedAt - c.startedAt) / 1000),
        energyKwh: c.kwh,
        rangeAddedKm: (c.endSoc - c.startSoc) * 5.31,
        avgPowerKw: c.powerKw,
        maxPowerKw: c.home ? c.powerKw : c.powerKw * 1.4,
        currency: 'USD',
        lat: at.lat,
        lon: at.lon,
        placesCheckedAt: new Date(now),
      };
    }),
  );
}

// The week's state history, for History's vehicle-state strip and battery line:
// awake and in drive for each drive, plugged in and charging overnight, asleep
// otherwise. Before the week, state history is live-only: the years above are
// drives and charges, not state.
const statesFrom = historyTo;
const statesTo = drive.startedAt.getTime();
type Reading = { at: number; field: string; value: string | number };
const readings: Reading[] = [];
const level = (at: number, pct: number) =>
  readings.push(
    { at, field: 'batteryLevel', value: Number(pct.toFixed(1)) },
    { at, field: 'distanceToEmpty', value: Math.round(pct * 5.31) },
  );
const parked = (at: number) =>
  readings.push(
    { at, field: 'powerState', value: 'standby' },
    { at, field: 'gearStatus', value: 'park' },
    { at, field: 'chargerStatus', value: 'chrgr_sts_not_connected' },
  );
parked(statesFrom);
level(statesFrom, WEEK_START_LEVEL);
for (const r of rows) {
  const { start, end } = levels.get(r.i)!;
  const endedAt = r.startedAt + (6 + r.km * 1.15) * 60_000;
  readings.push(
    { at: r.startedAt, field: 'powerState', value: 'go' },
    { at: r.startedAt, field: 'gearStatus', value: 'drive' },
  );
  level(r.startedAt, start);
  parked(endedAt);
  level(endedAt, end);
}
const charging = [
  ...nightCharges.map((c) => ({
    from: c.startedAt,
    to: c.startedAt + c.seconds * 1000,
    start: c.startSoc,
    end: c.endSoc,
  })),
  { from: chargeStart, to: chargeEnd, start: 43.2, end: 70 },
];
for (const c of charging) {
  readings.push({ at: c.from, field: 'chargerStatus', value: 'chrgr_sts_connected_charging' });
  // The level climbs through the night, a reading every half hour.
  for (let at = c.from; at < c.to; at += HOUR_MS / 2) {
    level(at, c.start + ((c.end - c.start) * (at - c.from)) / (c.to - c.from));
  }
  readings.push({ at: c.to, field: 'chargerStatus', value: 'chrgr_sts_not_connected' });
  level(c.to, c.end);
}
// Off on the drive home, where the mock carries on.
readings.push(
  { at: statesTo, field: 'powerState', value: 'go' },
  { at: statesTo, field: 'gearStatus', value: 'drive' },
);
level(statesTo, drive.startBattery);

const STATE_FIELDS = [
  'powerState',
  'gearStatus',
  'chargerStatus',
  'batteryLevel',
  'distanceToEmpty',
];
const fieldIds = await keys.fieldIds(STATE_FIELDS);
await db
  .delete(stateChanges)
  .where(
    and(
      eq(stateChanges.vehicleSeq, vehicleSeq),
      inArray(stateChanges.fieldId, [...fieldIds.values()]),
      gte(stateChanges.at, new Date(statesFrom)),
    ),
  );
await db
  .delete(stateHeartbeats)
  .where(
    and(eq(stateHeartbeats.vehicleSeq, vehicleSeq), gte(stateHeartbeats.at, new Date(statesFrom))),
  );
// One value per field and moment, the latest written winning.
const stateRows = new Map<string, typeof stateChanges.$inferInsert>();
for (const r of readings.sort((a, b) => a.at - b.at)) {
  stateRows.set(`${r.field}|${Math.round(r.at)}`, {
    vehicleSeq,
    fieldId: fieldIds.get(r.field)!,
    at: new Date(Math.round(r.at)),
    num: typeof r.value === 'number' ? r.value : null,
    value: typeof r.value === 'string' ? r.value : null,
  });
}
for (const chunk of chunks([...stateRows.values()], 1000)) {
  await db.insert(stateChanges).values(chunk).onConflictDoNothing();
}
// Heard from all week, every 15 minutes, so none of it reads as a gap.
await db
  .insert(stateHeartbeats)
  .values(
    Array.from({ length: Math.floor((statesTo - statesFrom) / HEARTBEAT_MS) + 1 }, (_, i) => ({
      vehicleSeq,
      at: new Date(statesFrom + i * HEARTBEAT_MS),
    })),
  )
  .onConflictDoNothing();

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

// Something on the Trips page: the latest finished drives and charges.
await db
  .delete(tripsTable)
  .where(and(eq(tripsTable.vehicleId, MOCK_VEHICLE_ID), eq(tripsTable.name, DEMO_TRIP)));
const [trip] = await db
  .insert(tripsTable)
  .values({ vehicleId: MOCK_VEHICLE_ID, name: DEMO_TRIP, notes: 'A few days away.' })
  .returning();
const finished = <T extends { id: number }>(rows: T[], kind: 'drive' | 'charge') =>
  rows.map((r) => ({
    tripId: trip!.id,
    vehicleId: MOCK_VEHICLE_ID,
    kind,
    activityId: r.id,
  }));
await db
  .insert(tripActivities)
  .values([
    ...finished(
      await db
        .select({ id: drives.id })
        .from(drives)
        .where(and(eq(drives.vehicleId, MOCK_VEHICLE_ID), isNotNull(drives.endedAt)))
        .orderBy(desc(drives.startedAt))
        .limit(8),
      'drive',
    ),
    ...finished(
      await db
        .select({ id: chargingSessions.id })
        .from(chargingSessions)
        .where(
          and(eq(chargingSessions.vehicleId, MOCK_VEHICLE_ID), isNotNull(chargingSessions.endedAt)),
        )
        .orderBy(desc(chargingSessions.startedAt))
        .limit(2),
      'charge',
    ),
  ])
  .onConflictDoNothing();

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
