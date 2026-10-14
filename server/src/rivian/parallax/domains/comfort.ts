/** `comfort.*`: cabin temperatures, preconditioning and defrost, as legacy fields. */
import { defineRvm, fieldsOrEmpty, readings, stampReadings } from '../define.js';
import { f32 } from '../wire.js';

export const RVM_CABIN_TEMPERATURES = 'comfort.cabin.cabin_temperatures';
export const RVM_PRECONDITIONING = 'comfort.cabin.cabin_preconditioning_status';
export const RVM_DEFROST = 'comfort.cabin.defrost_defog_status';
export const RVM_PET_MODE = 'comfort.cabin.pet_mode_status';

// Legacy's spellings: preconditioning off is the literal "undefined", and
// defrost is capitalized.
const PRECONDITIONING_STATUSES: Record<number, string> = {
  0: 'undefined',
  1: 'initiate',
  2: 'initiate',
  3: 'undefined',
  4: 'active',
};
const DEFROST_STATUSES: Record<number, string> = { 0: 'Off', 1: 'Off', 2: 'On', 4: 'Off' };

const temperature = (n: number | null | undefined) =>
  n != null && Number.isFinite(n) && n >= -80 && n <= 100 ? f32(n) : null;

/** `cabin_temperatures`: 3 cabin, 4 driver setting (float, °C). */
export const cabinTemperatures = defineRvm({
  rvm: RVM_CABIN_TEMPERATURES,
  group: 'vehicleState',
  maturity: 'confirmed',
  decode: (payload) =>
    readings((put) => {
      const m = fieldsOrEmpty(payload);
      put('cabinClimateInteriorTemperature', temperature(m?.float(3)));
      put('cabinClimateDriverTemperature', temperature(m?.float(4)));
    }),
  toState: stampReadings,
  stateKeys: ['cabinClimateInteriorTemperature', 'cabinClimateDriverTemperature'],
  fieldNames: { '3': 'Cabin (°C)', '4': 'Driver setting (°C)' },
});

/**
 * `cabin_preconditioning_status`: 1 status (1–2 initiate, 4 active, 0 or 3
 * off). Proto3 leaves a zero out, so an empty message is off. 8 is sent
 * just as legacy reports "unavailable" (9 of 9 times on an R1S, 2026-10-13);
 * it isn't read, so the last status holds.
 */
export const preconditioning = defineRvm({
  rvm: RVM_PRECONDITIONING,
  group: 'vehicleState',
  maturity: 'partial',
  decode: (payload) =>
    readings((put) => {
      const m = fieldsOrEmpty(payload);
      if (m) put('cabinPreconditioningStatus', PRECONDITIONING_STATUSES[m.int(1) ?? 0]);
    }),
  toState: stampReadings,
  stateKeys: ['cabinPreconditioningStatus'],
  fieldNames: { '1': 'Status (1–2 starting, 4 active, 0/3 off)' },
});

/** `defrost_defog_status`: 1 status (2 on; 0, 1 and 4 off). */
export const defrost = defineRvm({
  rvm: RVM_DEFROST,
  group: 'vehicleState',
  maturity: 'partial',
  decode: (payload) =>
    readings((put) => {
      const m = fieldsOrEmpty(payload);
      if (m) put('defrostDefogStatus', DEFROST_STATUSES[m.int(1) ?? 0]);
    }),
  toState: stampReadings,
  stateKeys: ['defrostDefogStatus'],
  fieldNames: { '1': 'Status (2 on)' },
});

// Logged for decoding, against legacy petModeStatus and
// petModeTemperatureStatus; nothing reads it yet.
export const petMode = defineRvm({
  rvm: RVM_PET_MODE,
  group: 'vehicleState',
  maturity: 'probe',
  store: 'log',
});

export const COMFORT_RVMS = [cabinTemperatures, preconditioning, defrost, petMode] as const;
