import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportError, type Reading } from '../imports/format.js';
import { ROAMER_VIN, roamerExport, zipOf } from '../../testing/roamer-archive.js';
import { roamerFormat } from './format.js';
import {
  chargeOf,
  destinationsFor,
  driveOf,
  fixOf,
  instant,
  metricState,
  navigationOf,
  placeOf,
} from './parse.js';

const at = (iso: string) => Date.parse(iso);

describe('Roamer records', () => {
  it('reads times as UTC, with or without a suffix', () => {
    expect(instant('2026-11-01T18:51:53.863')).toBe(at('2026-11-01T18:51:53.863Z'));
    expect(instant('2026-11-04T00:00:03.167+00:00')).toBe(at('2026-11-04T00:00:03.167Z'));
    expect(instant('2026-11-01T02:43:37.256703')).toBe(at('2026-11-01T02:43:37.256Z'));
    expect(instant('soon')).toBeNull();
    expect(instant(null)).toBeNull();
  });

  it('keeps the metrics live state has, under its names', () => {
    const state = metricState(
      {
        vehicle_mileage: 8481219,
        battery_level: 55.4,
        distance_to_empty: 297,
        gear_status: 'park',
        door_front_left_locked: 'locked',
        closure_side_bin_left_closed: 'closed',
        // Recoded by Roamer, so left out.
        seat_front_left_heat: 2,
        service_mode: false,
        range_threshold: 'vehicle_range_normal',
        cellular_carrier: 'AT&T',
        battery_capacity: null,
      },
      at('2026-11-04T00:00:00Z'),
    );
    expect(Object.fromEntries(Object.entries(state).map(([k, v]) => [k, v.value]))).toEqual({
      vehicleMileage: 8481219,
      batteryLevel: 55.4,
      distanceToEmpty: 297,
      gearStatus: 'park',
      doorFrontLeftLocked: 'locked',
      closureSideBinLeftClosed: 'closed',
    });
    expect(state['gearStatus']!.timeStamp).toBe('2026-11-04T00:00:00.000Z');
  });

  it('reads fixes, with speed from m/s', () => {
    expect(
      fixOf({ latitude: 33.1, longitude: -117.2, speed: 10, altitude: 50, bearing: 90 }),
    ).toEqual({ lat: 33.1, lon: -117.2, speedKmh: 36, altitudeM: 50, bearing: 90 });
    expect(fixOf({ latitude: 133, longitude: -117.2 })).toBeNull();
    expect(fixOf({ speed: 3 })).toBeNull();
  });

  it('takes drives in RivianMate’s units, leaving out corrupted ones', () => {
    const drive = driveOf({
      started_at: '2026-11-01T18:51:53.863',
      ended_at: '2026-11-01T19:02:19.053',
      start_odometer: 8481.219,
      end_odometer: 8488.769,
      start_battery_level: 70.1,
      end_battery_level: 69,
      start_range: 376,
      end_range: 371,
      total_distance: 7.55,
      primary_drive_mode: 'everyday',
      drive_mode_override: 'sport',
      elevation_gain: 85.355,
    });
    expect(drive).toMatchObject({
      startedAt: at('2026-11-01T18:51:53.863Z'),
      start: { mileageM: 8481219, battery: 70.1, rangeKm: 376 },
      end: { mileageM: 8488769 },
      distanceKm: 7.55,
      driveMode: 'sport',
      elevationGainM: 85.4,
    });
    expect(
      driveOf({
        started_at: '2026-11-01T18:51:53',
        ended_at: '2026-11-01T19:02:19',
        is_corrupted: true,
      }),
    ).toBeNull();
    expect(driveOf({ started_at: '2026-11-01T18:51:53' })).toBeNull();
  });

  it('times a charge by its periods, with the breakdown', () => {
    const charge = chargeOf({
      started_at: '2026-11-01T06:59:38.043',
      ended_at: '2026-11-01T12:28:13.045',
      duration_minutes: 329,
      periods: [
        { started_at: '2026-11-01T06:59:38Z', ended_at: '2026-11-01T08:59:38Z' },
        { started_at: '2026-11-01T10:00:00Z', ended_at: '2026-11-01T10:30:00Z' },
      ],
      total_energy_kwh: 37.70000076293945,
      pack_kwh: '36.300',
      thermal_kwh: 0,
      start_battery_level: 37.600002,
    });
    expect(charge).toMatchObject({
      chargingSeconds: 2.5 * 3600,
      energyKwh: 37.7,
      packKwh: 36.3,
      thermalKwh: 0,
      startSoc: 37.6,
    });
    expect(
      chargeOf({
        started_at: '2026-11-01T06:59:38',
        ended_at: '2026-11-01T07:59:38',
        duration_minutes: 60,
      })!.chargingSeconds,
    ).toBe(3600);
  });
});

describe('Roamer places and navigation', () => {
  it('reads saved places, keeping the radius in range and the rate in currency units', () => {
    expect(
      placeOf(
        {
          name: ' Home ',
          latitude: 33.07,
          longitude: -117.25,
          radius_meters: 5,
          price_per_kwh_minor: 14.5,
        },
        true,
      ),
    ).toEqual({
      name: 'Home',
      lat: 33.07,
      lon: -117.25,
      radiusM: 25,
      isHome: true,
      ratePerKwh: 0.145,
    });
    expect(placeOf({ name: 'Work', latitude: 32.88, longitude: -117.22 }, false)).toMatchObject({
      radiusM: 150,
      ratePerKwh: null,
    });
    expect(placeOf({ name: '', latitude: 1, longitude: 1 }, false)).toBeNull();
  });

  it('reads a navigation metric as where it was headed, or nowhere', () => {
    expect(
      navigationOf({
        observed_at: '2026-11-01T18:53:43+00:00',
        navigation_active: true,
        destination_name: 'Beach',
        destination_latitude: 32.7,
        destination_longitude: -117.1,
      }),
    ).toEqual({ at: at('2026-11-01T18:53:43Z'), to: { name: 'Beach', lat: 32.7, lon: -117.1 } });
    expect(
      navigationOf({ observed_at: '2026-11-01T18:53:43+00:00', navigation_active: false })!.to,
    ).toBeNull();
  });

  it('gives a drive where its navigation was headed, as live recording would', () => {
    const drive = (from: string, to: string) => driveOf({ started_at: from, ended_at: to })!;
    const beach = { name: 'Beach', lat: 1, lon: 1 };
    const store = { name: 'Store', lat: 2, lon: 2 };
    const drives = [
      // Set before setting off.
      drive('2026-01-01T10:00:00', '2026-01-01T10:30:00'),
      // Navigation stopped in between; this one set off without it.
      drive('2026-01-01T12:00:00', '2026-01-01T12:30:00'),
      // Set during the drive, and kept after navigation ends.
      drive('2026-01-01T14:00:00', '2026-01-01T14:30:00'),
    ];
    expect(
      destinationsFor(drives, [
        { at: at('2026-01-01T09:58:00Z'), to: beach },
        { at: at('2026-01-01T10:31:00Z'), to: null },
        { at: at('2026-01-01T14:05:00Z'), to: store },
        { at: at('2026-01-01T14:20:00Z'), to: null },
      ]),
    ).toEqual([beach, null, store]);
  });
});

describe('Roamer exports', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'roamer-test-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  let count = 0;
  /** Stores a file as an upload would be, returning the kept path and VINs. */
  const store = async (bytes: Buffer) => {
    count += 1;
    const upload = join(dir, `${count}.upload`);
    await writeFile(upload, bytes);
    return roamerFormat.store(upload, join(dir, String(count)), 1024 ** 2);
  };
  const options = { timeZone: 'UTC', vin: ROAMER_VIN };

  const exported = roamerExport({
    drive_sessions: [
      {
        started_at: '2026-01-01T10:00:00',
        ended_at: '2026-01-01T10:30:00',
        start_odometer: 100,
        end_odometer: 120,
        total_distance: 20,
        primary_driver_profile: 'Laura V.',
      },
    ],
    navigation_metrics: [
      {
        observed_at: '2026-01-01T10:02:00+00:00',
        navigation_active: true,
        destination_name: 'Beach',
        destination_latitude: 32.7,
        destination_longitude: -117.1,
      },
    ],
    saved_places: [
      { id: 'p1', name: 'Home', latitude: 33.07, longitude: -117.25, radius_meters: 100 },
      { id: 'p2', name: 'Work', latitude: 32.88, longitude: -117.22, radius_meters: 100 },
    ],
    rivian_favorites: [{ key: 'home', tagged_location_id: 'p1' }],
    charging_sessions: [
      {
        started_at: '2026-01-01T12:00:00',
        ended_at: '2026-01-01T13:00:00',
        start_battery_level: 50,
        end_battery_level: 60,
        total_energy_kwh: 11,
        pack_kwh: 10.5,
        thermal_kwh: 0.2,
      },
    ],
    vehicle_metrics: [
      { created_at: '2026-01-01T09:00:00+00:00', battery_capacity: 110, vehicle_mileage: 100000 },
      { created_at: '2026-01-01T10:10:00+00:00', gear_status: 'drive', battery_capacity: 111 },
      { created_at: '2026-01-01T12:10:00+00:00', battery_level: 52 },
      { created_at: '2026-01-01T12:20:00+00:00', cellular_carrier: 'AT&T' },
      { created_at: '2026-01-01T13:30:00+00:00', vehicle_mileage: 120000 },
    ],
    location_metrics: [
      { created_at: '2026-01-01T10:05:00+00:00', latitude: 33.1, longitude: -117.2, speed: 10 },
      { created_at: '2026-01-01T10:15:00+00:00', latitude: 33.2, longitude: -117.2, speed: 12 },
    ],
    charging_metrics: [
      { created_at: '2026-01-01T12:05:00+00:00', state: 3, power_kw: 7.4 },
      { created_at: '2026-01-01T12:15:00+00:00', state: 3, power_kw: 7.5 },
      { created_at: '2026-01-01T12:59:00+00:00', state: 4, power_kw: 0 },
    ],
  });

  it('refuses a zip that isn’t an export, and a file that isn’t a zip', async () => {
    await expect(store(zipOf({ 'notes.txt': 'hello' }))).rejects.toBeInstanceOf(ImportError);
    await expect(store(Buffer.from('data_id,Date\n1,2026-01-01'))).rejects.toThrow();
    await expect(
      store(zipOf({ 'manifest.json': JSON.stringify({ format_version: 2, files: {} }) })),
    ).rejects.toThrow('format RivianMate doesn’t know');
  });

  it('says which vehicles it has data for', async () => {
    expect((await store(exported)).vins).toEqual([ROAMER_VIN]);
  });

  it('reads sessions, with what the metrics add to them', async () => {
    const { path } = await store(exported);
    const scan = await roamerFormat.scan([path], options);
    expect(scan.drives).toHaveLength(1);
    // The capacity known when the drive set off, not one read during it.
    expect(scan.drives[0]!.batteryCapacityKwh).toBe(110);
    expect(scan.drives[0]).toMatchObject({
      driverName: 'Laura V.',
      destination: { name: 'Beach', lat: 32.7, lon: -117.1 },
    });
    expect(scan.places.map((p) => [p.name, p.isHome])).toEqual([
      ['Home', true],
      ['Work', false],
    ]);
    expect(scan.charges).toHaveLength(1);
    expect(scan.charges[0]!.curve).toEqual([
      { at: at('2026-01-01T12:05:00Z'), powerKw: 7.4, soc: 50 },
      { at: at('2026-01-01T12:15:00Z'), powerKw: 7.5, soc: 52 },
    ]);
    expect(scan.rows).toBe(7);
    // The carrier alone isn't a reading RivianMate keeps.
    expect(scan.readingTimes).toHaveLength(4);
    expect(scan.firstMileage?.value).toBe(100000);
    expect(scan.lastMileage?.value).toBe(120000);
    await expect(roamerFormat.scan([path], { ...options, vin: 'OTHER' })).rejects.toThrow(
      'no data for that vehicle',
    );
  });

  it('gives metrics and fixes in time order', async () => {
    const { path } = await store(exported);
    const readings: Reading[] = [];
    for await (const r of roamerFormat.readings([path], options)) readings.push(r);
    expect(readings.map((r) => new Date(r.at).toISOString().slice(11, 16))).toEqual([
      '09:00',
      '10:05',
      '10:10',
      '10:15',
      '12:10',
      '12:20',
      '13:30',
    ]);
    expect(readings[1]).toMatchObject({ reporting: false, fix: { speedKmh: 36 } });
    expect(readings[2]).toMatchObject({ reporting: true, fix: null });
  });
});
