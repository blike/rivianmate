import { describe, expect, it } from 'vitest';
import {
  PARALLAX_CORE_TOPICS,
  PARALLAX_RVMS,
  PARALLAX_STATE_FIELDS,
  PARALLAX_STORED_RVMS,
  domainOf,
  isProbe,
  rvmDef,
} from './index.js';

describe('Parallax registry', () => {
  it('defines each topic once', () => {
    const rvms = PARALLAX_RVMS.map((def) => def.rvm);
    expect(new Set(rvms).size).toBe(rvms.length);
  });

  it('names the fields of every topic it decodes, and lists every state field it writes', () => {
    for (const def of PARALLAX_RVMS) {
      if (def.decode) expect(Object.keys(def.fieldNames ?? {}), def.rvm).not.toHaveLength(0);
      if (def.toState) expect(def.stateKeys ?? [], def.rvm).not.toHaveLength(0);
    }
  });

  it('archives the topics without a decoder as probes, nothing reading them', () => {
    expect(new Set(PARALLAX_RVMS.filter(isProbe).map((def) => def.rvm))).toEqual(
      new Set([
        'charging.session.trip_target',
        'charging.session.notification',
        'ota.ota_state.vehicle_ota_state',
        'ota.user_schedule.ota_config',
        'charging.session.power',
        'charging.session.remote_command',
        'charging.energy.state',
        'charging.smart_charging.settings',
        'charging.smart_charging.smart_charging_info',
        'charging.smart_charging.weighted_charging_forecast',
        'comfort.cabin.hvac_settings_status',
        'comfort.cabin.climate_hold_setting',
        'comfort.cabin.climate_hold_status',
        'comfort.cabin.cabin_ventilation_setting',
        'comfort.user_modes.state',
        'dynamics.vehicle.location',
        'dynamics.vehicle.efficiency',
        'dynamics.vehicle.mass_estimate',
        'body.windows.states',
        'body.trailer.state',
        'vehicle.profiles.active_user',
        'security.alarm.state',
        'security.video_monitoring.state',
        'security.access.immobilizer_state',
        'departure.schedule.schedule',
      ]),
    );
    expect(isProbe({})).toBe(true);
    expect(isProbe({ decode: () => null })).toBe(false);
  });

  it('names only read topics for vehicles without the Parallax feature', () => {
    expect(PARALLAX_CORE_TOPICS).toHaveLength(13);
    for (const rvm of PARALLAX_CORE_TOPICS) {
      const def = rvmDef(rvm);
      expect(def && !isProbe(def), rvm).toBe(true);
    }
  });

  it('merges every legacy field Parallax supplies by timestamp', () => {
    expect(new Set(PARALLAX_STATE_FIELDS)).toEqual(
      new Set([
        'gnssLocation',
        'gnssAltitude',
        'gnssBearing',
        'gnssSpeed',
        ...['FrontLeft', 'FrontRight', 'RearLeft', 'RearRight'].flatMap((p) => [
          `tirePressure${p}`,
          `tirePressureStatus${p}`,
        ]),
        'powerState',
        'gearStatus',
        'vehicleMileage',
        'distanceToEmpty',
        'rangeThreshold',
        'rangeTemperatureImpact',
        'batteryLevel',
        'batteryCapacity',
        'batteryLimit',
        'twelveVoltBatteryHealth',
        'otaCurrentVersion',
        'otaAvailableVersion',
        'otaStatus',
        'otaCurrentStatus',
        'otaDownloadProgress',
        'otaInstallProgress',
        'otaInstallDuration',
        'driveMode',
        'brakeFluidLow',
        'wiperFluidState',
        'chargePortState',
        'chargerStatus',
        'chargerState',
        'cabinClimateInteriorTemperature',
        'cabinClimateDriverTemperature',
        'cabinClimateExteriorTemperature',
        'batteryHvThermalEvent',
        'cabinPreconditioningStatus',
        'cabinPreconditioningType',
        'defrostDefogStatus',
        'petModeStatus',
        'steeringWheelHeat',
        'rearGlassHeat',
        'windshieldHeat',
        'sideMirrorHeat',
        'wiperHeat',
        'seatFrontLeftHeat',
        'seatFrontLeftVent',
        'seatFrontMiddleHeat',
        'seatFrontRightHeat',
        'seatFrontRightVent',
        'seatRearLeftHeat',
        'seatRearLeftVent',
        'seatRearMiddleHeat',
        'seatRearRightHeat',
        'seatRearRightVent',
        'seatThirdRowLeftHeat',
        'seatThirdRowMiddleHeat',
        'seatThirdRowRightHeat',
        'doorFrontLeftClosed',
        'doorFrontRightClosed',
        'doorRearLeftClosed',
        'doorRearRightClosed',
        'closureFrunkClosed',
        'closureTailgateClosed',
        'closureLiftgateClosed',
        'closureSideBinLeftClosed',
        'closureSideBinRightClosed',
        'closureTonneauClosed',
        'windowFrontLeftClosed',
        'windowFrontRightClosed',
        'windowRearLeftClosed',
        'windowRearRightClosed',
        'windowRearGlassClosed',
        'doorFrontLeftLocked',
        'doorFrontRightLocked',
        'doorRearLeftLocked',
        'doorRearRightLocked',
        'closureFrunkLocked',
        'closureTailgateLocked',
        'closureLiftgateLocked',
        'closureSideBinLeftLocked',
        'closureSideBinRightLocked',
        'closureChargePortLocked',
        'closureTrunkSecurityLocked',
        'closureCenterConsoleLocked',
        'closureGloveBoxLocked',
        'gearGuardLocked',
        'closureTonneauLocked',
      ]),
    );
  });

  it('keeps the latest payload of the insight and charging topics', () => {
    expect(PARALLAX_STORED_RVMS.has('energy.high_voltage.battery_state')).toBe(true);
    expect(PARALLAX_STORED_RVMS.has('charging.session.status')).toBe(true);
    expect(PARALLAX_STORED_RVMS.has('dynamics.vehicle.gnss')).toBe(false);
    expect(PARALLAX_STORED_RVMS.has('body.locks.states')).toBe(false);
  });

  it("groups topics under Rivian's domains", () => {
    expect(domainOf('energy_edge_compute.graphs.charging_graph_global')).toBe('energy');
    expect(domainOf('body.closures.states')).toBe('body');
  });
});
