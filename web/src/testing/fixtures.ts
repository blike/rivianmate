/** Sample vehicle data for page render tests. */
import type { ChargingSessionDto, DriveDto, VehicleDto } from '@server/api-types';

export const ID = 'v1';
const now = Date.now();
export const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
const reading = (value: string | number, h = 0.1) => ({ value, timeStamp: ago(h) });

export const vehicle: VehicleDto = {
  id: ID,
  vin: 'VIN',
  name: 'Rover',
  make: 'Rivian',
  model: 'R1S',
  modelYear: 2023,
  renders: [],
  source: 'rivian',
};

export const parkedState = {
  batteryLevel: reading(78.4),
  batteryLimit: reading(85),
  distanceToEmpty: reading(342),
  vehicleMileage: reading(19_960_000),
  gearStatus: reading('park'),
  powerState: reading('ready'),
  chargerStatus: reading('chrgr_sts_not_connected'),
  cabinClimateInteriorTemperature: reading(21),
  cabinClimateDriverTemperature: reading(22),
  doorFrontLeftClosed: reading('closed'),
  doorFrontLeftLocked: reading('locked'),
  closureFrunkClosed: reading('open'),
  closureFrunkLocked: reading('locked'),
  tirePressureFrontLeft: reading(3.0),
  tirePressureStatusFrontLeft: reading('OK'),
  tirePressureRearRight: reading(2.4),
  tirePressureStatusRearRight: reading('LOW'),
  otaCurrentVersion: reading('2026.38.1'),
  gnssLocation: { latitude: 40.5, longitude: -89, timeStamp: ago(0.1) },
};

export const drives: DriveDto[] = [
  {
    id: 2,
    startedAt: ago(5),
    endedAt: ago(4.5),
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    distanceKm: 18.2,
    startBattery: 82,
    endBattery: 78.4,
    energyKwh: 4.6,
    elevationGainM: null,
    elevationLossM: null,
    startRangeKm: null,
    endRangeKm: null,
    maxSpeedKmh: null,
    outsideTempC: null,
    weather: null,
    driveMode: null,
    destination: null,
    start: { label: 'Work', address: null, isHome: false, locationId: 2 },
    end: { label: 'Home', address: null, isHome: true, locationId: 1 },
  },
];

export const sessions = [
  {
    id: 7,
    vehicleId: ID,
    startedAt: ago(30),
    endedAt: ago(22),
    chargerId: null,
    chargerType: null,
    startSoc: 40,
    endSoc: 82,
    chargingSeconds: 5 * 3600,
    chargingSince: null,
    chargingStartedAt: ago(29),
    chargingEndedAt: ago(24),
    energyKwh: 54.1,
    packKwh: null,
    thermalKwh: null,
    rangeAddedKm: null,
    avgPowerKw: 10,
    maxPowerKw: 11,
    cost: null,
    currency: 'USD',
    lat: null,
    lon: null,
    isHome: true,
    location: { id: 1, name: 'Home', isHome: true },
    estimatedCost: '7.09',
    estimatedEnergyKwh: null,
    socLimit: 85,
    source: 'live',
    vendor: null,
    city: null,
    isPublic: false,
  },
] satisfies ChargingSessionDto[];
