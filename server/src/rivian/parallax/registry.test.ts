import { describe, expect, it } from 'vitest';
import {
  PARALLAX_GROUPS,
  PARALLAX_LOGGED_RVMS,
  PARALLAX_RVMS,
  PARALLAX_STATE_FIELDS,
  PARALLAX_STORED_RVMS,
  domainOf,
  groupOf,
  parallaxGroupTopics,
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

  it('subscribes each group to the topics it always has', () => {
    expect(new Set(parallaxGroupTopics('dynamics'))).toEqual(
      new Set(['dynamics.vehicle.gnss', 'dynamics.tires.state']),
    );
    expect(new Set(parallaxGroupTopics('vehicleState'))).toEqual(
      new Set([
        'vehicle.power.state',
        'dynamics.vehicle.gear',
        'dynamics.vehicle.odometer',
        'body.closures.states',
        'body.locks.states',
        'comfort.cabin.cabin_temperatures',
        'comfort.cabin.cabin_preconditioning_status',
        'comfort.cabin.defrost_defog_status',
        'dynamics.vehicle.range',
        'energy.low_voltage.battery_state',
        'ota.deployment.state',
      ]),
    );
    expect(parallaxGroupTopics('core')).toHaveLength(13);
    expect(new Set(parallaxGroupTopics('probe'))).toEqual(
      new Set([
        'charging.session.trip_target',
        'charging.session.notification',
        'comfort.cabin.pet_mode_status',
        'ota.ota_state.vehicle_ota_state',
        'ota.user_schedule.ota_config',
      ]),
    );
    // Every topic is subscribed in some group.
    const subscribed = PARALLAX_GROUPS.flatMap((g) => parallaxGroupTopics(g.id));
    expect(subscribed).toHaveLength(PARALLAX_RVMS.length);
  });

  it('subscribes unverified topics apart from the working groups', () => {
    expect(groupOf({ group: 'vehicleState', maturity: 'probe' })).toBe('probe');
    expect(groupOf({ group: 'vehicleState', maturity: 'partial' })).toBe('vehicleState');
  });

  it('only subscribes core for vehicles without the Parallax feature', () => {
    expect(PARALLAX_GROUPS.filter((g) => !g.needsFeatureFlag).map((g) => g.id)).toEqual(['core']);
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
        'batteryLevel',
        'batteryCapacity',
        'batteryLimit',
        'twelveVoltBatteryHealth',
        'otaCurrentVersion',
        'chargePortState',
        'chargerStatus',
        'cabinClimateInteriorTemperature',
        'cabinClimateDriverTemperature',
        'cabinPreconditioningStatus',
        'defrostDefogStatus',
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
      ]),
    );
  });

  it('keeps the insight topics and logs the charging ones', () => {
    expect(PARALLAX_STORED_RVMS.has('energy.high_voltage.battery_state')).toBe(true);
    expect(PARALLAX_STORED_RVMS.has('dynamics.vehicle.gnss')).toBe(false);
    expect(PARALLAX_STORED_RVMS.has('body.locks.states')).toBe(false);
    expect(PARALLAX_LOGGED_RVMS.has('charging.session.status')).toBe(true);
    expect(PARALLAX_LOGGED_RVMS.has('energy.high_voltage.battery_state')).toBe(false);
    for (const rvm of PARALLAX_LOGGED_RVMS) expect(PARALLAX_STORED_RVMS.has(rvm)).toBe(true);
  });

  it("groups topics under Rivian's domains", () => {
    expect(domainOf('energy_edge_compute.graphs.charging_graph_global')).toBe('energy');
    expect(domainOf('body.closures.states')).toBe('body');
  });
});
