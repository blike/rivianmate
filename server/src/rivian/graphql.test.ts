import { describe, expect, it } from 'vitest';
import {
  CORE_VEHICLE_STATE_PROPERTIES,
  buildVehicleStateQuery,
  buildVehicleStateSubscription,
  SUBSCRIPTION_PROPERTIES,
  VEHICLE_STATE_PROPERTIES,
} from './graphql.js';

describe('graphql builders', () => {
  it('uses special templates for connection/location fields', () => {
    const query = buildVehicleStateQuery(VEHICLE_STATE_PROPERTIES);
    expect(query).toContain('cloudConnection { lastSync isOnline }');
    expect(query).toContain('gnssLocation { latitude longitude timeStamp }');
    expect(query).toContain('batteryLevel { timeStamp value }');
    expect(query).toContain('$vehicleID: String!');
  });

  it('keeps live tire pressures out of the polling query', () => {
    expect(buildVehicleStateQuery(VEHICLE_STATE_PROPERTIES)).not.toContain(
      'tirePressureFrontLeft ',
    );
    expect(buildVehicleStateSubscription(SUBSCRIPTION_PROPERTIES)).toContain(
      'tirePressureFrontLeft { timeStamp value }',
    );
  });
});

describe('field lists', () => {
  it('does not request fields Rivian is known to reject', () => {
    for (const field of [
      'cabinClimateExteriorTemperature',
      'cabinClimateRunning',
      'vehiclePowerOutput',
      'regenerativeBrakingPower',
      'gnssError',
    ]) {
      expect(SUBSCRIPTION_PROPERTIES).not.toContain(field);
    }
    expect(buildVehicleStateQuery(VEHICLE_STATE_PROPERTIES)).not.toContain('isAuthorized');
  });

  it('keeps the core fallback a subset of the full list', () => {
    for (const field of CORE_VEHICLE_STATE_PROPERTIES) {
      expect(VEHICLE_STATE_PROPERTIES).toContain(field);
    }
  });
});
