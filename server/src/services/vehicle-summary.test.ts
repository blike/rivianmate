import { describe, expect, it } from 'vitest';
import type { LiveSessionData, VehicleState } from '../rivian/types.js';
import {
  type SummaryVehicleMeta,
  buildVehicleSummary,
  resolveSummaryUnits,
} from './vehicle-summary.js';

const ts = '2026-11-24T20:24:53.464Z';
const v = (value: string | number | null) => ({ timeStamp: ts, value });

const VEHICLE: SummaryVehicleMeta = {
  id: '01-test',
  vin: '7PDSGABA000000001',
  name: 'Blue',
  make: 'Rivian',
  model: 'R1S',
  modelYear: 2025,
  source: 'rivian',
};

const SAMPLE_STATE: VehicleState = {
  cloudConnection: { lastSync: ts, isOnline: true },
  gnssLocation: { latitude: 40.5142, longitude: -88.9906, timeStamp: ts },
  batteryLevel: v(78.46),
  batteryLimit: v(80),
  batteryCapacity: v(135.24),
  batteryTempAvg: v(16), // 16°C = 60.8°F
  distanceToEmpty: v(389),
  vehicleMileage: v(518000),
  gnssSpeed: v(20), // 20 m/s = 72 km/h = 44.7 mph
  gnssAltitude: v(250), // 250 m = 820 ft
  gearStatus: v('park'),
  driveMode: v('everyday'),
  powerState: v('ready'),
  chargerStatus: v('chrgr_sts_connected_charging'),
  chargerState: v('charging_active'),
  timeToEndOfCharge: v(42.4),
  cabinClimateInteriorTemperature: v(20), // 20°C = 68°F
  cabinClimateDriverTemperature: v(21.5), // 21.5°C = 70.7°F
  tirePressureFrontLeft: v(3.31), // 48.0 psi
  tirePressureFrontRight: v(3.31),
  tirePressureRearLeft: v(3.31),
  tirePressureRearRight: v(3.25),
  doorFrontLeftClosed: v('closed'),
  doorFrontLeftLocked: v('locked'),
  doorFrontRightClosed: v('open'),
  doorFrontRightLocked: v('unlocked'),
  otaCurrentVersion: v('2026.10.01'),
  otaAvailableVersion: v('2026.14.01'),
};

describe('resolveSummaryUnits', () => {
  it('resolves imperial, metric, and user unit modes', () => {
    expect(resolveSummaryUnits('imperial', { distance: 'km', temperature: 'C' })).toEqual({
      distance: 'mi',
      temperature: 'F',
    });
    expect(resolveSummaryUnits('metric', { distance: 'mi', temperature: 'F' })).toEqual({
      distance: 'km',
      temperature: 'C',
    });
    expect(resolveSummaryUnits('user', { distance: 'km', temperature: 'F' })).toEqual({
      distance: 'km',
      temperature: 'F',
    });
  });
});

describe('buildVehicleSummary', () => {
  it('converts Rivian SI readings to imperial units and derives status/security fields', () => {
    const live = { power: { value: 11.44, updatedAt: ts } } as LiveSessionData;
    const summary = buildVehicleSummary(
      VEHICLE,
      SAMPLE_STATE,
      { distance: 'mi', temperature: 'F' },
      live,
    );

    expect(summary).toMatchObject({
      id: '01-test',
      name: 'Blue',
      model: 'R1S',
      status: 'charging',
      statusLabel: 'Charging',
      online: true,
      batteryLevel: 78.5,
      batteryLimit: 80,
      batteryCapacityKwh: 135.2,
      batteryTemp: 60.8,
      range: 241.7,
      odometer: 321.9,
      speed: 44.7,
      altitude: 820,
      pluggedIn: true,
      charging: true,
      timeToEndOfChargeMin: 42,
      chargingPowerKw: 11.4,
      cabinTemp: 68,
      targetTemp: 70.7,
      tirePressures: {
        frontLeft: 48,
        frontRight: 48,
        rearLeft: 48,
        rearRight: 47.1,
      },
      locked: false,
      openClosures: ['Passenger door'],
      softwareVersion: '2026.10.01',
      updateAvailable: '2026.14.01',
      location: { lat: 40.5142, lon: -88.9906, ts },
      units: {
        distance: 'mi',
        speed: 'mph',
        temperature: 'F',
        pressure: 'psi',
        elevation: 'ft',
      },
    });
  });

  it('converts Rivian SI readings to metric units (km, km/h, m, °C, bar)', () => {
    const summary = buildVehicleSummary(VEHICLE, SAMPLE_STATE, {
      distance: 'km',
      temperature: 'C',
    });

    expect(summary).toMatchObject({
      range: 389,
      odometer: 518,
      speed: 72,
      altitude: 250,
      cabinTemp: 20,
      targetTemp: 21.5,
      tirePressures: {
        frontLeft: 3.31,
        frontRight: 3.31,
        rearLeft: 3.31,
        rearRight: 3.25,
      },
      chargingPowerKw: null,
      units: {
        distance: 'km',
        speed: 'km/h',
        temperature: 'C',
        pressure: 'bar',
        elevation: 'm',
      },
    });
  });

  it('classifies driving, plugged, asleep, parked and ignores placeholder OTA versions', () => {
    expect(
      buildVehicleSummary(
        VEHICLE,
        {
          gearStatus: v('drive'),
          otaCurrentVersion: v('2026.10.01'),
          otaAvailableVersion: v('0.0.0'),
        },
        { distance: 'mi', temperature: 'F' },
      ),
    ).toMatchObject({
      status: 'driving',
      statusLabel: 'Driving',
      pluggedIn: false,
      charging: false,
      locked: null,
      openClosures: [],
      updateAvailable: null,
    });

    expect(
      buildVehicleSummary(
        VEHICLE,
        { chargerStatus: v('chrgr_sts_connected_no_chrg') },
        { distance: 'mi', temperature: 'F' },
      ),
    ).toMatchObject({
      status: 'plugged',
      statusLabel: 'Plugged in',
      pluggedIn: true,
      charging: false,
    });

    expect(
      buildVehicleSummary(
        VEHICLE,
        { powerState: v('sleep') },
        { distance: 'mi', temperature: 'F' },
      ),
    ).toMatchObject({ status: 'asleep', statusLabel: 'Asleep' });

    expect(buildVehicleSummary(VEHICLE, {}, { distance: 'mi', temperature: 'F' })).toMatchObject({
      status: 'parked',
      statusLabel: 'Parked',
    });
  });

  it('marks pluggedIn and Charging when chargerState or liveCharging is active before chargerStatus arrives', () => {
    expect(
      buildVehicleSummary(
        VEHICLE,
        { chargerState: v('charging_active') },
        { distance: 'mi', temperature: 'F' },
      ),
    ).toMatchObject({
      status: 'charging',
      statusLabel: 'Charging',
      pluggedIn: true,
      charging: true,
    });

    const live = {
      vehicleChargerState: { value: 'charging_active', updatedAt: ts },
      power: { value: 1.44, updatedAt: ts },
      timeRemaining: { value: 3600, updatedAt: ts },
    } as LiveSessionData;
    expect(
      buildVehicleSummary(VEHICLE, {}, { distance: 'mi', temperature: 'F' }, live),
    ).toMatchObject({
      status: 'charging',
      statusLabel: 'Charging',
      pluggedIn: true,
      charging: true,
      chargingPowerKw: 1.4,
      timeToEndOfChargeMin: 60,
    });
  });

  it('ignores stale navLocation speed when gnssLocation is newer', () => {
    const staleNavState: VehicleState = {
      gnssLocation: { latitude: 33.58, longitude: -84.21, timeStamp: '2026-11-25T04:04:05Z' },
      navLocation: {
        latitude: 33.58,
        longitude: -84.21,
        timeStamp: '2026-11-24T19:58:10Z',
        speedMps: 7.532,
      },
    };
    expect(
      buildVehicleSummary(VEHICLE, staleNavState, { distance: 'mi', temperature: 'F' }).speed,
    ).toBeNull();
  });
});
