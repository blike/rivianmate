/**
 * TeslaMate reads against a real Postgres, in a schema shaped like
 * TeslaMate's. Skipped unless TEST_DATABASE_URL points at a disposable
 * database; it only creates and drops the `teslamate_test` schema.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LiveBus } from '../services/live-bus.js';
import type { LiveSessionData } from '../rivian/types.js';
import { TeslaMateSource, connectReadOnly } from './source.js';

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = 'teslamate_test';
// Home's rate, with Home elsewhere: the Home geofence alone makes a charge home charging.
const home = {
  settings: { currency: 'USD' },
  locations: [{ id: 1, name: 'Home', lat: 0, lon: 0, radiusM: 150, isHome: true, ratePerKwh: 0.2 }],
  wallboxes: [],
};

/** `minutes` ago in TeslaMate's UTC timestamps. */
const ago = (minutes: number) => `(now() AT TIME ZONE 'UTC') - interval '${minutes} minutes'`;

const FIXTURE = `
  INSERT INTO settings (preferred_range) VALUES ('rated');
  INSERT INTO cars (id, eid, vid, model, efficiency, vin, name, marketing_name) VALUES
    (1, 11, 101, '3', 0.153, '5YJ3E1EA7MF000001', 'Sparky', 'LR AWD'),
    (2, 12, 102, 'Y', 0.16, '7SAYGDEE5RF000002', NULL, NULL);
  INSERT INTO geofences (id, name, latitude, longitude) VALUES (1, 'Home', 37.0, -122.0);
  INSERT INTO addresses (id, display_name, latitude, longitude, name, house_number, road, city) VALUES
    (1, '12 Main Street, Springfield, USA', 37.0, -122.0, NULL, '12', 'Main Street', 'Springfield'),
    (2, 'Acme HQ, 1 Work Way, Shelbyville, USA', 37.1, -122.1, 'Acme HQ', '1', 'Work Way', 'Shelbyville'),
    (3, 'Supercharger, Highway 1, Ogdenville', 37.5, -122.5, NULL, NULL, 'Highway 1', 'Ogdenville');

  -- A finished drive two days ago, home to work.
  INSERT INTO drives (id, car_id, start_date, end_date, distance, start_km, end_km, speed_max,
      ascent, descent, start_rated_range_km, end_rated_range_km, start_ideal_range_km,
      end_ideal_range_km, start_position_id, end_position_id, start_address_id, end_address_id,
      start_geofence_id, duration_min)
    VALUES (1, 1, ${ago(2880)}, ${ago(2850)}, 25, 1000, 1025, 95, 20, 15, 400, 375, 420, 395,
      1, 3, 1, 2, 1, 30);
  INSERT INTO positions (id, car_id, drive_id, date, latitude, longitude, speed, odometer,
      battery_level, usable_battery_level, ideal_battery_range_km, rated_battery_range_km,
      elevation, inside_temp, outside_temp, tpms_pressure_fl, tpms_pressure_fr, tpms_pressure_rl,
      tpms_pressure_rr)
    VALUES
      (1, 1, 1, ${ago(2880)}, 37.0, -122.0, 0, 1000, 80, 80, 420, 400, 10, 20, 15, 2.9, 2.9, 2.9, 2.9),
      (2, 1, 1, ${ago(2865)}, 37.05, -122.05, 90, 1012, NULL, NULL, NULL, NULL, 30, NULL, NULL, NULL, NULL, NULL, NULL),
      (3, 1, 1, ${ago(2850)}, 37.1, -122.1, 0, 1025, 75, 75, 395, 375, 15, 21, 16, 2.9, 2.9, 2.9, 2.8);

  -- A finished charge at home yesterday.
  INSERT INTO positions (id, car_id, date, latitude, longitude, odometer, battery_level,
      usable_battery_level, ideal_battery_range_km, rated_battery_range_km)
    VALUES (4, 1, ${ago(1440)}, 37.0, -122.0, 1050, 50, 50, 260, 250);
  INSERT INTO charging_processes (id, car_id, start_date, end_date, charge_energy_added,
      start_battery_level, end_battery_level, duration_min, start_rated_range_km,
      end_rated_range_km, start_ideal_range_km, end_ideal_range_km, position_id, address_id,
      geofence_id)
    VALUES (1, 1, ${ago(1440)}, ${ago(1260)}, 30, 50, 90, 180, 250, 450, 260, 470, 4, 1, 1);
  INSERT INTO charges (charging_process_id, date, battery_level, usable_battery_level,
      charge_energy_added, charger_power, ideal_battery_range_km, rated_battery_range_km,
      fast_charger_present)
    VALUES
      (1, ${ago(1430)}, 52, 52, 1, 11, 270, 260, false),
      (1, ${ago(1350)}, 70, 70, 15, 11, 370, 350, false),
      (1, ${ago(1261)}, 90, 90, 30, 11, 470, 450, false);

  -- A charge TeslaMate never closed, ten days ago.
  INSERT INTO charging_processes (id, car_id, start_date, start_battery_level, position_id)
    VALUES (3, 1, ${ago(14400)}, 40, 4);
  INSERT INTO charges (charging_process_id, date, battery_level, charge_energy_added,
      charger_power, ideal_battery_range_km)
    VALUES (3, ${ago(14340)}, 45, 4, 11, 230);

  -- Car 1 is driving now.
  INSERT INTO drives (id, car_id, start_date) VALUES (2, 1, ${ago(10)});
  INSERT INTO positions (id, car_id, drive_id, date, latitude, longitude, speed, odometer,
      battery_level, usable_battery_level, ideal_battery_range_km, rated_battery_range_km, elevation)
    VALUES
      (5, 1, 2, ${ago(10)}, 37.0, -122.0, 0, 1100, 70, 70, 370, 350, 10),
      (6, 1, 2, ${ago(5)}, 37.02, -122.02, 80, 1104, 69, 69, 365, 345, 40),
      (7, 1, 2, ${ago(0.5)}, 37.03, -122.03, 60, 1106, NULL, NULL, NULL, NULL, 20);
  INSERT INTO states (car_id, state, start_date) VALUES (1, 'online', ${ago(60)});
  INSERT INTO updates (car_id, start_date, end_date, version) VALUES
    (1, ${ago(43200)}, ${ago(43170)}, '2024.20.1 aaaa1111'),
    (1, ${ago(7200)}, ${ago(7170)}, '2024.26.7 bbbb2222');

  -- Car 2 is supercharging now.
  INSERT INTO positions (id, car_id, date, latitude, longitude, odometer, battery_level,
      usable_battery_level, ideal_battery_range_km, rated_battery_range_km)
    VALUES (8, 2, ${ago(20)}, 37.5, -122.5, 5000, 20, 20, 110, 100);
  INSERT INTO charging_processes (id, car_id, start_date, start_battery_level,
      start_rated_range_km, start_ideal_range_km, position_id, address_id)
    VALUES (2, 2, ${ago(20)}, 20, 100, 110, 8, 3);
  INSERT INTO charges (charging_process_id, date, battery_level, usable_battery_level,
      charge_energy_added, charger_power, ideal_battery_range_km, rated_battery_range_km,
      fast_charger_present, fast_charger_brand, charger_actual_current)
    VALUES
      (2, ${ago(19)}, 22, 22, 1.5, 120, 120, 110, true, 'Tesla', 300),
      (2, ${ago(1)}, 45, 45, 18.2, 150, 240, 225, true, 'Tesla', 380);
  INSERT INTO states (car_id, state, start_date) VALUES (2, 'online', ${ago(25)});
`;

describe.skipIf(!url)('TeslaMateSource with Postgres', () => {
  let admin: postgres.Sql;
  let source: TeslaMateSource;
  const bus = new LiveBus();
  const sessions = new Map<string, LiveSessionData | null>();
  bus.onChargingSession((id, s) => sessions.set(id, s));

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    await admin.unsafe(
      `SET search_path TO ${SCHEMA}; ${readFileSync(join(here, 'testing', 'schema.sql'), 'utf8')}; ${FIXTURE}`,
    );
    source = new TeslaMateSource(bus, undefined, { search_path: SCHEMA });
    await source.configure(url!);
  });

  afterAll(async () => {
    await source?.stop();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin?.end();
  });

  it('refuses writes on its connection', async () => {
    const sql = connectReadOnly(url!, { search_path: SCHEMA });
    try {
      await expect(sql`INSERT INTO settings (preferred_range) VALUES ('ideal')`).rejects.toThrow(
        /read-only/,
      );
    } finally {
      await sql.end();
    }
  });

  it('tests a URL, and rejects a database that is not TeslaMate', async () => {
    await expect(source.test(url!)).resolves.toEqual({ cars: 2 });
    const plain = new TeslaMateSource(bus, undefined, { search_path: 'public' });
    await expect(plain.test(url!)).rejects.toThrow(/doesn't look like TeslaMate/);
  });

  it('lists the cars as vehicles', () => {
    expect(source.status()).toMatchObject({ configured: true, connected: true, error: null });
    expect(source.getVehicles()).toEqual([
      {
        id: 'tm-1',
        vin: '5YJ3E1EA7MF000001',
        name: 'Sparky',
        make: 'Tesla',
        model: 'Model 3',
        modelYear: 2021,
        renders: [],
        source: 'teslamate',
      },
      expect.objectContaining({ id: 'tm-2', name: 'Model Y', modelYear: 2024 }),
    ]);
  });

  it('reads a driving car’s live state', () => {
    const state = source.getState('tm-1')!;
    expect(state.gnssLocation).toMatchObject({ latitude: 37.03, longitude: -122.03 });
    expect(state.gnssSpeed).toMatchObject({ value: 60 / 3.6 });
    expect(state.batteryLevel).toMatchObject({ value: 69 });
    expect(state.distanceToEmpty).toMatchObject({ value: 345 });
    expect(state.vehicleMileage).toMatchObject({ value: 1106 * 1000 });
    expect(state.gearStatus).toMatchObject({ value: 'drive' });
    expect(state.powerState).toMatchObject({ value: 'go' });
    expect(state.otaCurrentVersion).toMatchObject({ value: '2024.26.7' });
    expect(sessions.get('tm-1') ?? null).toBeNull();
  });

  it('publishes a charge in progress as a live session', () => {
    expect(source.getState('tm-2')!.chargerStatus).toMatchObject({
      value: 'chrgr_sts_connected_charging',
    });
    expect(sessions.get('tm-2')).toMatchObject({
      power: { value: 150 },
      soc: { value: 45 },
      totalChargedEnergy: { value: 18.2 },
      rangeAddedThisSession: { value: 125 },
      vehicleChargerState: { value: 'charging_active' },
    });
  });

  it('maps drives, including the one under way', async () => {
    const drives = await source.drives('tm-1', home, { limit: 200 });
    expect(drives.map((d) => d.id)).toEqual([2, 1]);
    const [live, done] = drives;
    expect(live).toMatchObject({
      endedAt: null,
      distanceKm: 6,
      startBattery: 70,
      endBattery: 69,
      maxSpeedKmh: 80,
      start: { label: 'Home', isHome: true },
      end: null,
    });
    expect(done).toMatchObject({
      distanceKm: 25,
      startBattery: 80,
      endBattery: 75,
      elevationGainM: 20,
      elevationLossM: 15,
      startRangeKm: 400,
      endRangeKm: 375,
      maxSpeedKmh: 95,
      start: { label: 'Home', isHome: true },
      end: { label: 'Acme HQ, Shelbyville', isHome: false },
    });
    expect(done!.energyKwh).toBeCloseTo(25 * 0.153);
  });

  it('ends drives and charges TeslaMate left open at their last reading, once newer ones exist', async () => {
    // A restart mid-drive leaves the drive open for good; it isn't under way.
    await admin.unsafe(`SET search_path TO ${SCHEMA};
      INSERT INTO drives (id, car_id, start_date, start_km) VALUES (3, 1, ${ago(4320)}, 900);
      INSERT INTO positions (id, car_id, drive_id, date, latitude, longitude, speed, odometer)
        VALUES (9, 1, 3, ${ago(4320)}, 37.0, -122.0, 0, 900),
               (10, 1, 3, ${ago(4310)}, 37.05, -122.05, 50, 906),
               (11, 1, 3, ${ago(4300)}, 37.1, -122.1, 0, 912),
               -- Trips on later days still land in the open drive; it ends at the first stop.
               (12, 1, 3, ${ago(3000)}, 37.2, -122.2, 60, 950);`);
    try {
      const drives = await source.drives('tm-1', home, { limit: 200 });
      const abandoned = drives.find((d) => d.id === 3)!;
      expect(Date.parse(abandoned.endedAt!) - Date.parse(abandoned.startedAt)).toBe(20 * 60_000);
      expect(abandoned.distanceKm).toBe(12);
      expect([abandoned.endLat, abandoned.endLon]).toEqual([37.1, -122.1]);
      expect((await source.drive('tm-1', 3, home))?.points).toHaveLength(3);
      // The newest open drive is still the one under way.
      expect(drives.find((d) => d.id === 2)!.endedAt).toBeNull();
    } finally {
      await admin.unsafe(`SET search_path TO ${SCHEMA};
        DELETE FROM positions WHERE drive_id = 3; DELETE FROM drives WHERE id = 3;`);
    }
    // The fixture's charge left open ten days ago ends at its one reading.
    const sessions = await source.chargingSessions('tm-1', home, { limit: 200 });
    const charge = sessions.find((s) => s.id === 3)!;
    expect(Date.parse(charge.endedAt!) - Date.parse(charge.startedAt)).toBe(60 * 60_000);
    expect(charge).toMatchObject({ chargingSince: null, energyKwh: 4, endSoc: 45 });
  });

  it('lists only the drives that started in a window', async () => {
    const day = new Date(Date.now() - 86_400_000);
    const recent = await source.drives('tm-1', home, { from: day, limit: 200 });
    expect(recent.map((d) => d.id)).toEqual([2]);
    const older = await source.drives('tm-1', home, { to: day, limit: 200 });
    expect(older.map((d) => d.id)).toEqual([1]);
    // The next page: those that started before the oldest so far.
    const [newest] = await source.drives('tm-1', home, { limit: 1 });
    const next = await source.drives('tm-1', home, {
      before: new Date(newest!.startedAt),
      limit: 1,
    });
    expect([newest!.id, next.map((d) => d.id)]).toEqual([2, [1]]);
    const coverage = await source.driveCoverage('tm-1');
    expect(Date.parse(coverage.since!)).toBeLessThan(day.getTime());
  });

  it('reads a drive’s route, and only for its own car', async () => {
    const detail = await source.drive('tm-1', 1, home);
    expect(detail?.points.map((p) => p.speedKmh)).toEqual([0, 90, 0]);
    expect(detail?.points[1]).toMatchObject({ lat: 37.05, lon: -122.05, altitude: 30 });
    expect(await source.drive('tm-2', 1, home)).toBeNull();
    expect((await source.drive('tm-1', 2, home))?.elevationGainM).toBe(30);
  });

  it('maps charging sessions and their curves', async () => {
    const [done] = await source.chargingSessions('tm-1', home, { limit: 200 });
    expect(done).toMatchObject({
      id: 1,
      vehicleId: 'tm-1',
      isHome: true,
      chargerId: 'Home',
      startSoc: 50,
      endSoc: 90,
      energyKwh: 30,
      rangeAddedKm: 200,
      avgPowerKw: 10,
      maxPowerKw: 11,
      chargingSeconds: 180 * 60,
      cost: null,
      estimatedCost: '6.00',
      source: 'teslamate',
    });
    const [running] = await source.chargingSessions('tm-2', home, { limit: 200 });
    expect(running).toMatchObject({
      endedAt: null,
      chargerId: 'Tesla Supercharger',
      city: 'Ogdenville',
      isHome: false,
      isPublic: true,
      endSoc: 45,
      energyKwh: 18.2,
      maxPowerKw: 150,
    });
    const curve = await source.chargingCurve('tm-1', 1);
    expect(curve.map((p) => [p.powerKw, p.soc])).toEqual([
      [11, 52],
      [11, 70],
      [11, 90],
    ]);
    expect(await source.chargingCurve('tm-2', 1)).toEqual([]);
  });

  it('reads history, charge spans and locations', async () => {
    const from = new Date(Date.now() - 3 * 86_400_000);
    const to = new Date();
    const raw = await source.history('tm-1', { metric: 'battery', from, to, bucket: 'raw' });
    expect(raw.map((p) => p.avg)).toEqual([80, 75, 50, 70, 69]);
    const daily = await source.history('tm-1', { metric: 'mileage', from, to, bucket: '1d' });
    expect(daily.length).toBeGreaterThan(0);
    expect(daily.at(-1)!.max).toBe(1104 * 1000);
    const spans = await source.chargeSpans('tm-1', from, to);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.kind).toBe('charging');
    // The unclosed charge ends at its last reading, not now.
    const older = await source.chargeSpans('tm-1', new Date(Date.now() - 11 * 86_400_000), to);
    expect(older).toHaveLength(2);
    expect(Date.parse(older[0]!.to) - Date.parse(older[0]!.from)).toBe(60 * 60_000);
    const trail = await source.locations('tm-1', from, to);
    // Each drive keeps its route's ends (drive 1 runs straight); parked points stay apart.
    expect(trail.map((p) => p.driveId ?? null)).toEqual([1, 1, null, 2, 2]);
  });

  it('reads what the car was doing: awake, then the drive under way', async () => {
    const now = new Date();
    const spans = await source.stateSpans('tm-1', new Date(now.getTime() - 2 * 3600_000), now);
    expect(spans.map((s) => s.state)).toEqual(['awake', 'driving', 'awake']);
    // The open drive ends at its last position, half a minute ago.
    expect(now.getTime() - Date.parse(spans[1]!.to)).toBeCloseTo(30_000, -3);
    // The software update ten days ago.
    const older = await source.stateSpans(
      'tm-1',
      new Date(now.getTime() - 7300 * 60_000),
      new Date(now.getTime() - 7100 * 60_000),
    );
    expect(older.map((s) => s.state)).toEqual(['updating']);
  });

  it('works out energy used while parked over the last day and week', async () => {
    const { parkedEnergy } = await source.insights('tm-1');
    const [week, day] = [...parkedEnergy!.windows].sort((a, b) => b.minutes - a.minutes);
    const capacity = (450 * 0.153) / 0.9;
    // A day: from the charge's 90% to the drive under way at 70%.
    expect(day!.kwh).toBeCloseTo(0.2 * capacity, 1);
    // 345 km at 69% is 5 km per percent.
    expect(day!.rangeKm).toBeCloseTo(100, 0);
    // A week adds the stretch after the earlier drive, 75% down to 50%.
    expect(week!.kwh).toBeCloseTo(0.45 * capacity, 1);
    expect(day!.uses).toBeNull();

    const balance = await source.batteryWindow(
      'tm-1',
      new Date(Date.now() - 3 * 86_400_000),
      new Date(),
    );
    expect(balance).toMatchObject({ startLevel: 80, endLevel: 69, parkedLossPct: 45 });
  });

  it('reads health: tires, capacity and software', async () => {
    const tires = await source.tirePressures('tm-1', 7);
    expect(tires.length).toBeGreaterThan(0);
    expect(tires.flatMap((t) => [t.frontLeft, t.rearRight])).toContain(2.85);
    const battery = await source.batteryHealth('tm-1');
    // 450 km rated × 0.153 kWh/km at 90% usable.
    expect(battery.latest?.kwh).toBeCloseTo((450 * 0.153) / 0.9);
    expect(battery.ratedCapacity?.kwh).toBeCloseTo((450 * 0.153) / 0.9);
    const ota = await source.ota('tm-1');
    expect(ota).toMatchObject({ current: '2024.26.7', available: null });
    expect(ota.versions.map((v) => v.version)).toEqual(['2024.26.7', '2024.20.1']);
    const drain = await source.phantomDrain('tm-1', 7, 'UTC');
    expect(drain).toHaveProperty('days');
  });

  it('forgets everything when removed', async () => {
    const other = new TeslaMateSource(new LiveBus(), undefined, { search_path: SCHEMA });
    await other.configure(url!);
    expect(other.getVehicles()).toHaveLength(2);
    await other.configure(null);
    expect(other.status()).toMatchObject({ configured: false, vehicles: [] });
    expect(await other.drives('tm-1', home, { limit: 200 })).toEqual([]);
  });
});
