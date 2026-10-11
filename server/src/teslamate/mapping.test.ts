import { describe, expect, it } from 'vitest';
import { DEFAULT_HOME_CHARGING } from '../services/home-charging.js';
import { isTeslaMateVehicle, teslamateCarId, teslamateVehicleId } from './ids.js';
import {
  type CarSnapshot,
  type ChargingProcessRow,
  type PositionRow,
  buildVehicleState,
  capacityHistory,
  driveEnergyKwh,
  drivePlace,
  geofenceAt,
  liveChargingSession,
  modelName,
  shortAddress,
  softwareVersion,
  toSessionDto,
  vinModelYear,
} from './mapping.js';

const at = (iso: string) => new Date(iso);

function position(over: Partial<PositionRow> = {}): PositionRow {
  return {
    date: at('2026-10-10T12:00:00Z'),
    latitude: 37,
    longitude: -122,
    speed: null,
    power: null,
    odometer: 1000,
    ideal_battery_range_km: 400,
    rated_battery_range_km: 380,
    battery_level: 80,
    usable_battery_level: 79,
    outside_temp: 12,
    inside_temp: 20,
    driver_temp_setting: 21,
    is_climate_on: false,
    is_front_defroster_on: false,
    is_rear_defroster_on: null,
    elevation: 50,
    tpms_pressure_fl: 2.9,
    tpms_pressure_fr: 2.9,
    tpms_pressure_rl: 2.8,
    tpms_pressure_rr: 2.8,
    ...over,
  };
}

const snapshot = (over: Partial<CarSnapshot> = {}): CarSnapshot => ({
  full: position(),
  moving: null,
  state: { state: 'online', start_date: at('2026-10-10T11:00:00Z'), end_date: null },
  driveId: null,
  charging: null,
  version: { version: '2024.26.7', at: at('2026-10-01T00:00:00Z') },
  ...over,
});

describe('vehicle ids', () => {
  it('round-trips car ids and leaves Rivian ids alone', () => {
    expect(teslamateVehicleId(3)).toBe('tm-3');
    expect(teslamateCarId('tm-3')).toBe(3);
    expect(teslamateCarId('tm-x')).toBeNull();
    expect(teslamateCarId('01-234567')).toBeNull();
    expect(isTeslaMateVehicle('01-234567')).toBe(false);
    expect(isTeslaMateVehicle(undefined)).toBe(false);
  });
});

describe('car details', () => {
  it('names models and reads the model year from the VIN', () => {
    expect(modelName('3')).toBe('Model 3');
    expect(modelName('y')).toBe('Model Y');
    expect(modelName('Cybertruck')).toBe('Cybertruck');
    expect(modelName(null)).toBeNull();
    expect(vinModelYear('5YJ3E1EA7MF000001')).toBe(2021);
    expect(vinModelYear('7SAYGDEE5RF000002')).toBe(2024);
    expect(vinModelYear('short')).toBeNull();
  });

  it('drops the build hash from software versions', () => {
    expect(softwareVersion('2024.26.7 a1b2c3d4')).toBe('2024.26.7');
    expect(softwareVersion('  ')).toBeNull();
  });
});

describe('buildVehicleState', () => {
  it('reports a parked car with the preferred range', () => {
    const state = buildVehicleState(snapshot(), 'rated');
    expect(state.batteryLevel).toEqual({ timeStamp: '2026-10-10T12:00:00.000Z', value: 80 });
    expect(state.distanceToEmpty?.value).toBe(380);
    expect(buildVehicleState(snapshot(), 'ideal').distanceToEmpty?.value).toBe(400);
    expect(state.vehicleMileage?.value).toBe(1_000_000);
    expect(state.gearStatus?.value).toBe('park');
    expect(state.powerState?.value).toBe('ready');
    expect(state.chargerStatus?.value).toBe('chrgr_sts_not_connected');
    expect(state.gnssSpeed?.value).toBe(0);
    expect(state.tirePressureRearLeft?.value).toBe(2.8);
    expect(state.climateOn?.value).toBe('false');
    expect(state.defrostDefogStatus?.value).toBe('off');
    expect(state.otaCurrentVersion?.value).toBe('2024.26.7');
    expect(state.cloudConnection).toEqual({ lastSync: '2026-10-10T12:00:00.000Z', isOnline: true });
  });

  it('follows the drive’s latest streamed position while driving', () => {
    const state = buildVehicleState(
      snapshot({
        driveId: 9,
        moving: position({
          date: at('2026-10-10T12:05:00Z'),
          latitude: 37.1,
          speed: 72,
          odometer: 1004,
          battery_level: null,
          rated_battery_range_km: null,
          ideal_battery_range_km: null,
        }),
      }),
      'rated',
    );
    expect(state.gnssLocation).toMatchObject({ latitude: 37.1 });
    expect(state.gnssSpeed?.value).toBe(20);
    expect(state.vehicleMileage?.value).toBe(1_004_000);
    // Battery stays with the last full report.
    expect(state.batteryLevel?.value).toBe(80);
    expect(state.powerState?.value).toBe('go');
    expect(state.gearStatus?.value).toBe('drive');
  });

  it('reads battery from the charge in progress when it is newer', () => {
    const state = buildVehicleState(
      snapshot({
        charging: {
          process: {
            id: 1,
            start_date: at('2026-10-10T12:10:00Z'),
            start_battery_level: 80,
            start_ideal_range_km: 400,
            start_rated_range_km: 380,
          },
          latest: {
            date: at('2026-10-10T12:30:00Z'),
            battery_level: 84,
            charge_energy_added: 3,
            charger_power: 0,
            charger_voltage: 240,
            charger_actual_current: 0,
            fast_charger_present: false,
            ideal_battery_range_km: 420,
            rated_battery_range_km: 399,
          },
        },
      }),
      'rated',
    );
    expect(state.batteryLevel?.value).toBe(84);
    expect(state.distanceToEmpty?.value).toBe(399);
    // Plugged in but drawing nothing.
    expect(state.chargerStatus?.value).toBe('chrgr_sts_connected_no_chrg');
  });

  it('shows a sleeping car as asleep', () => {
    const state = buildVehicleState(
      snapshot({
        state: { state: 'asleep', start_date: at('2026-10-10T13:00:00Z'), end_date: null },
      }),
      'rated',
    );
    expect(state.powerState).toEqual({ timeStamp: '2026-10-10T13:00:00.000Z', value: 'sleep' });
    expect(state.cloudConnection?.isOnline).toBe(false);
  });
});

describe('liveChargingSession', () => {
  it('is null unless charging, and estimates range per hour from efficiency', () => {
    expect(liveChargingSession(snapshot(), 'rated', 0.15)).toBeNull();
    const session = liveChargingSession(
      snapshot({
        charging: {
          process: {
            id: 1,
            start_date: at('2026-10-10T12:00:00Z'),
            start_battery_level: 50,
            start_ideal_range_km: 260,
            start_rated_range_km: 250,
          },
          latest: {
            date: at('2026-10-10T12:30:00Z'),
            battery_level: 60,
            charge_energy_added: 7.5,
            charger_power: 15,
            charger_voltage: 240,
            charger_actual_current: 48,
            fast_charger_present: false,
            ideal_battery_range_km: 310,
            rated_battery_range_km: 300,
          },
        },
      }),
      'rated',
      0.15,
      Date.parse('2026-10-10T12:30:00Z'),
    );
    expect(session).toMatchObject({
      startTime: '2026-10-10T12:00:00.000Z',
      timeElapsed: 1800,
      power: { value: 15, updatedAt: '2026-10-10T12:30:00.000Z' },
      soc: { value: 60 },
      rangeAddedThisSession: { value: 50 },
      kilometersChargedPerHour: { value: 100 },
      vehicleChargerState: { value: 'charging_active' },
    });
  });
});

describe('places', () => {
  const work = {
    name: 'Acme HQ',
    house_number: '1',
    road: 'Work Way',
    city: 'Shelbyville',
    display_name: 'Acme HQ, 1 Work Way, Shelbyville',
  };

  it('shortens addresses like Rivian’s', () => {
    expect(shortAddress(work)).toBe('Acme HQ, Shelbyville');
    expect(shortAddress({ ...work, name: null })).toBe('1 Work Way, Shelbyville');
    expect(shortAddress({ ...work, name: null, road: null, house_number: null, city: null })).toBe(
      'Acme HQ',
    );
    expect(shortAddress(null)).toBeNull();
  });

  it('calls a Home geofence or the home spot home', () => {
    expect(drivePlace('home', work, 1, 1, [])).toMatchObject({ label: 'Home', isHome: true });
    expect(drivePlace(null, work, 37, -122, [{ lat: 37, lon: -122 }])).toMatchObject({
      label: 'Home',
    });
    expect(drivePlace('Office', work, 1, 1, [])).toEqual({
      label: 'Office',
      address: work.display_name,
      isHome: false,
    });
    expect(drivePlace(null, null, 1, 1, [])).toBeNull();
  });

  it('finds the nearest geofence containing a point', () => {
    const fences = [
      { name: 'Home', latitude: 37, longitude: -122, radius: 50 },
      { name: 'Street', latitude: 37.0003, longitude: -122, radius: 100 },
    ];
    expect(geofenceAt(37.0001, -122, fences)).toBe('Home');
    expect(geofenceAt(37.0008, -122, fences)).toBe('Street');
    expect(geofenceAt(38, -122, fences)).toBeNull();
    expect(geofenceAt(null, null, fences)).toBeNull();
  });
});

describe('driveEnergyKwh', () => {
  it('is range used times efficiency, and null for range gained', () => {
    expect(driveEnergyKwh(400, 380, 0.15)).toBeCloseTo(3);
    expect(driveEnergyKwh(380, 400, 0.15)).toBeNull();
    expect(driveEnergyKwh(400, 380, null)).toBeNull();
  });
});

describe('toSessionDto', () => {
  const row: ChargingProcessRow = {
    id: 7,
    started_at: at('2026-10-09T20:00:00Z'),
    ended_at: at('2026-10-09T22:00:00Z'),
    charge_energy_added: 20,
    start_battery_level: 40,
    end_battery_level: 70,
    duration_min: 120,
    start_ideal_range_km: 210,
    end_ideal_range_km: 370,
    start_rated_range_km: 200,
    end_rated_range_km: 350,
    cost: null,
    lat: 37,
    lon: -122,
    geofence: null,
    address: null,
    max_power: 11,
    fast: false,
    brand: null,
    latest_battery_level: null,
    latest_energy: null,
    latest_ideal_range_km: null,
    latest_rated_range_km: null,
  };
  const home = {
    settings: { ...DEFAULT_HOME_CHARGING, ratePerKwh: 0.15, currency: 'CAD' },
    spots: [{ lat: 37, lon: -122 }],
  };

  it('prices home sessions at the home rate', () => {
    expect(toSessionDto(row, { vehicleId: 'tm-1', range: 'rated', home })).toMatchObject({
      isHome: true,
      chargerId: 'AC charger',
      cost: null,
      estimatedCost: '3.00',
      currency: 'CAD',
      avgPowerKw: 10,
      rangeAddedKm: 150,
      chargingSeconds: 7200,
      chargingSince: null,
    });
  });

  it('names Superchargers and keeps TeslaMate’s cost', () => {
    const dto = toSessionDto(
      { ...row, fast: true, brand: 'Tesla', cost: 12.345, lat: 1, lon: 1 },
      { vehicleId: 'tm-1', range: 'rated', home },
    );
    expect(dto).toMatchObject({
      isHome: false,
      isPublic: true,
      chargerId: 'Tesla Supercharger',
      cost: '12.35',
      estimatedCost: null,
    });
  });

  it('shows a running session’s readings so far', () => {
    const dto = toSessionDto(
      {
        ...row,
        ended_at: null,
        duration_min: null,
        latest_battery_level: 55,
        latest_energy: 9,
        latest_rated_range_km: 270,
      },
      { vehicleId: 'tm-1', range: 'rated', home },
    );
    expect(dto).toMatchObject({
      endedAt: null,
      endSoc: 55,
      energyKwh: 9,
      rangeAddedKm: 70,
      chargingSeconds: 0,
      chargingSince: '2026-10-09T20:00:00.000Z',
      avgPowerKw: null,
    });
  });
});

describe('capacityHistory', () => {
  it('derives capacity as TeslaMate does, one reading per day', () => {
    const rows = [
      { at: at('2026-10-01T08:00:00Z'), rated_battery_range_km: 450, usable_battery_level: 90 },
      { at: at('2026-10-01T20:00:00Z'), rated_battery_range_km: 400, usable_battery_level: 80 },
      { at: at('2026-10-05T08:00:00Z'), rated_battery_range_km: 300, usable_battery_level: 10 },
      { at: at('2026-10-06T08:00:00Z'), rated_battery_range_km: 380, usable_battery_level: 80 },
    ];
    const result = capacityHistory(rows, 0.15);
    expect(result.reported.map((r) => r.day)).toEqual(['2026-10-01', '2026-10-06']);
    expect(result.latest?.kwh).toBeCloseTo(71.25);
    expect(result.ratedCapacity?.kwh).toBeCloseTo(75);
    expect(capacityHistory(rows, null)).toEqual({
      latest: null,
      reported: [],
      ratedCapacity: null,
    });
  });
});
