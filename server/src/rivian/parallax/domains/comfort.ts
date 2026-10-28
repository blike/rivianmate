/**
 * `comfort.*`: cabin temperatures, preconditioning, defrost, pet mode and
 * seat and steering wheel heat and vents, as legacy fields.
 */
import { defineRvm, fieldsOrEmpty, readings, stampReadings } from '../define.js';
import { f32 } from '../wire.js';

export const RVM_CABIN_TEMPERATURES = 'comfort.cabin.cabin_temperatures';
export const RVM_PRECONDITIONING = 'comfort.cabin.cabin_preconditioning_status';
export const RVM_DEFROST = 'comfort.cabin.defrost_defog_status';
export const RVM_PET_MODE = 'comfort.cabin.pet_mode_status';
export const RVM_SEAT_CONDITIONING = 'comfort.cabin.seat_conditioning_status';

// Legacy's spellings: preconditioning off is the literal "undefined", and
// defrost is capitalized. Preconditioning values legacy hasn't been seen
// sending (initiate, active_warning and the timeouts and errors) are named
// in its style, after the Rivian app's.
const PRECONDITIONING_STATUSES: Record<number, string> = {
  0: 'undefined',
  1: 'initiate',
  2: 'active',
  3: 'active_warning',
  4: 'complete_maintain',
  5: 'timeout_temperature_not_achieved',
  6: 'error_soc_low',
  7: 'error_system_fault',
  8: 'unavailable',
  9: 'timeout_complete',
};
const PRECONDITIONING_TYPES: Record<number, string> = {
  0: 'NONE',
  1: 'USER_SELECTED',
  2: 'SCREEN_PROTECTION',
  3: 'SCHEDULED',
  4: 'AUTO_CABIN_VENTILATION',
};
// Defog, defrost, or both, are all on.
const DEFROST_STATUSES: Record<number, string> = { 0: 'Off', 1: 'On', 2: 'On', 3: 'On', 4: 'Off' };
const PET_MODE_STATUSES: Record<number, string> = { 0: 'Off', 1: 'On', 2: 'Disabled' };

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
 * `cabin_preconditioning_status`: 1 status (1 initiate, 2 active, 3 active
 * with a warning, 4 complete and holding, 5–7 and 9 timeouts and errors, 8
 * unavailable), 2 type (1 user selected, 2 screen protection, 3 scheduled, 4
 * auto cabin ventilation). Proto3 leaves a zero out, so an empty message is
 * off. Against legacy on an R1S: 2 with type 1 came as it reported active
 * and USER_SELECTED (2026-10-18), 4 as it reported complete_maintain
 * (2026-10-16), and 8 each of 95 times it reported unavailable.
 */
export const preconditioning = defineRvm({
  rvm: RVM_PRECONDITIONING,
  group: 'vehicleState',
  maturity: 'partial',
  decode: (payload) =>
    readings((put) => {
      const m = fieldsOrEmpty(payload);
      if (!m) return;
      put('cabinPreconditioningStatus', PRECONDITIONING_STATUSES[m.int(1) ?? 0]);
      put('cabinPreconditioningType', PRECONDITIONING_TYPES[m.int(2) ?? 0]);
    }),
  toState: stampReadings,
  stateKeys: ['cabinPreconditioningStatus', 'cabinPreconditioningType'],
  fieldNames: {
    '1': 'Status (1 starting, 2 active, 3 warning, 4 holding, 8 unavailable)',
    '2': 'Type (1 user, 2 screen protection, 3 scheduled, 4 auto ventilation)',
  },
});

/** `defrost_defog_status`: 1 status (1 defog, 2 defrost, 3 both, 4 off). */
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
  fieldNames: { '1': 'Status (1 defog, 2 defrost, 3 both, 4 off)' },
});

/**
 * `pet_mode_status`: 1 status (1 on, 2 disabled), 2 temperature status (1
 * cold, 2 hot, 3 faulty), 3 cabin climate (1 cold, 2 hot). Proto3 leaves a
 * zero out, so an empty message is off, and a temperature or climate left
 * out is the default (legacy's petModeTemperatureStatus "Default"). Seen
 * switching with legacy's petModeStatus on an R1S (2026-10-18); 2 and 3
 * haven't been seen set, so they aren't read.
 */
export const petMode = defineRvm({
  rvm: RVM_PET_MODE,
  group: 'vehicleState',
  maturity: 'partial',
  decode: (payload) =>
    readings((put) => {
      const m = fieldsOrEmpty(payload);
      if (m) put('petModeStatus', PET_MODE_STATUSES[m.int(1) ?? 0]);
    }),
  toState: stampReadings,
  stateKeys: ['petModeStatus'],
  fieldNames: {
    '1': 'Status (1 on, 2 disabled)',
    '2': 'Temperature (1 cold, 2 hot, 3 faulty)',
    '3': 'Cabin (1 cold, 2 hot)',
  },
});

/**
 * `seat_conditioning_status` surfaces' legacy fields, by entry kind (1)
 * and position (2: 1 heat, 2 vent). Legacy has no third row, so those are
 * named in its style.
 */
const SURFACE_FIELDS: Record<string, string> = {
  '1/1': 'steeringWheelHeat',
  '5/1': 'seatFrontLeftHeat',
  '5/2': 'seatFrontLeftVent',
  '7/1': 'seatFrontRightHeat',
  '7/2': 'seatFrontRightVent',
  '8/1': 'seatRearLeftHeat',
  '10/1': 'seatRearRightHeat',
  '11/1': 'seatThirdRowLeftHeat',
  '13/1': 'seatThirdRowRightHeat',
};
const SURFACE_LEVELS: Record<number, string> = {
  0: 'Off',
  1: 'Level_1',
  2: 'Level_2',
  3: 'Level_3',
};

/** Each known surface's raw level (3), by its legacy field; a level left out is zero. */
function surfaceLevels(payload: string): Record<string, number> {
  const levels: Record<string, number> = {};
  for (const e of fieldsOrEmpty(payload)?.repeated(1) ?? []) {
    const field = SURFACE_FIELDS[`${e.int(1)}/${e.int(2)}`];
    if (field) levels[field] = e.int(3) ?? 0;
  }
  return levels;
}

/**
 * `seat_conditioning_status`: an entry per heated or ventilated surface,
 * 1 kind (which seat, or 1 the steering wheel), 2 position (1 heat, 2
 * vent) and 3 level (0 off, 1–3), in legacy's spellings. Each surface was
 * seen switching with its legacy field on an R1S (2026-10-18), the third
 * row by hand; levels 1–3 were seen on the front left seat's heat and
 * assumed for the rest.
 */
export const seatConditioning = defineRvm({
  rvm: RVM_SEAT_CONDITIONING,
  group: 'vehicleState',
  maturity: 'partial',
  decode: (payload) =>
    readings((put) => {
      for (const [field, level] of Object.entries(surfaceLevels(payload))) {
        put(field, SURFACE_LEVELS[level]);
      }
    }),
  toState: stampReadings,
  stateKeys: Object.values(SURFACE_FIELDS),
  entryLabels: {
    field: 1,
    key: 1,
    labels: {
      1: 'Steering wheel',
      5: 'Front left seat',
      7: 'Front right seat',
      8: 'Rear left seat',
      10: 'Rear right seat',
      11: 'Third row left seat',
      13: 'Third row right seat',
    },
  },
  fieldNames: {
    '1.1': 'Surface: kind',
    '1.2': 'Surface: 1 heat, 2 vent',
    '1.3': 'Surface: level (0 off, 1–3)',
  },
});

export const COMFORT_RVMS = [
  cabinTemperatures,
  preconditioning,
  defrost,
  petMode,
  seatConditioning,
] as const;
