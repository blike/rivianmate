/** `comfort.*`: cabin temperatures, preconditioning, defrost, pet mode and surface heat, as legacy fields. */
import { defineRvm, fieldsOrEmpty, readings, stampReadings } from '../define.js';
import { f32 } from '../wire.js';

export const RVM_CABIN_TEMPERATURES = 'comfort.cabin.cabin_temperatures';
export const RVM_PRECONDITIONING = 'comfort.cabin.cabin_preconditioning_status';
export const RVM_DEFROST = 'comfort.cabin.defrost_defog_status';
export const RVM_PET_MODE = 'comfort.cabin.pet_mode_status';
export const RVM_SEAT_CONDITIONING = 'comfort.cabin.seat_conditioning_status';

// Legacy's spellings: preconditioning off is the literal "undefined", and
// defrost is capitalized. Values legacy hasn't sent are named in its style.
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
const PET_MODE_STATUSES: Record<number, string> = {
  0: 'Off',
  1: 'On',
  2: 'Disabled',
  3: 'Faulty',
};

const temperature = (n: number | null | undefined) =>
  n != null && Number.isFinite(n) && n >= -80 && n <= 100 ? f32(n) : null;

/** `cabin_temperatures`: 1 zones {1 seat, 2 °C}, 2 outside, 3 cabin, 4 driver setting (°C). */
export const cabinTemperatures = defineRvm({
  rvm: RVM_CABIN_TEMPERATURES,
  decode: (payload) =>
    readings((put) => {
      const m = fieldsOrEmpty(payload);
      put('cabinClimateInteriorTemperature', temperature(m?.float(3)));
      put('cabinClimateDriverTemperature', temperature(m?.float(4)));
      put('cabinClimateExteriorTemperature', temperature(m?.float(2)));
    }),
  toState: stampReadings,
  stateKeys: [
    'cabinClimateInteriorTemperature',
    'cabinClimateDriverTemperature',
    'cabinClimateExteriorTemperature',
  ],
  fieldNames: {
    '1.1': 'Zone: seat',
    '1.2': 'Zone: temperature (°C)',
    '2': 'Outside (°C)',
    '3': 'Cabin (°C)',
    '4': 'Driver setting (°C)',
  },
});

/**
 * `cabin_preconditioning_status`: 1 status (1 initiate, 2 active, 3 active
 * with a warning, 4 complete and holding, 5–7 and 9 timeouts and errors, 8
 * unavailable), 2 type (1 user, 2 screen protection, 3 scheduled, 4 auto
 * ventilation). An empty message is off.
 */
export const preconditioning = defineRvm({
  rvm: RVM_PRECONDITIONING,
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
 * `pet_mode_status`: 1 status (1 on, 2 disabled, 3 faulty); an empty
 * message is off. 2 (temperature) and 3 (cabin climate) aren't read: 3
 * says "hot" while pet mode is disabled, so its meaning is unclear.
 */
export const petMode = defineRvm({
  rvm: RVM_PET_MODE,
  decode: (payload) =>
    readings((put) => {
      const m = fieldsOrEmpty(payload);
      if (m) put('petModeStatus', PET_MODE_STATUSES[m.int(1) ?? 0]);
    }),
  toState: stampReadings,
  stateKeys: ['petModeStatus'],
  fieldNames: {
    '1': 'Status (1 on, 2 disabled, 3 faulty)',
    '2': 'Temperature (1 cold, 2 hot, 3 faulty)',
    '3': 'Cabin (1 cold, 2 hot)',
  },
});

/**
 * Surfaces' legacy fields, by kind and position (1 heat, 2 vent). Kinds: 1
 * steering wheel, 2 rear glass, 3 windshield, 4 mirrors, 5–7 front row,
 * 8–10 second, 11–13 third (left, middle, right), 14 wiper area. Those
 * legacy lacks are named in its style.
 */
const SURFACE_FIELDS: Record<string, string> = {
  '1/1': 'steeringWheelHeat',
  '2/1': 'rearGlassHeat',
  '3/1': 'windshieldHeat',
  '4/1': 'sideMirrorHeat',
  '5/1': 'seatFrontLeftHeat',
  '5/2': 'seatFrontLeftVent',
  '6/1': 'seatFrontMiddleHeat',
  '7/1': 'seatFrontRightHeat',
  '7/2': 'seatFrontRightVent',
  '8/1': 'seatRearLeftHeat',
  '8/2': 'seatRearLeftVent',
  '9/1': 'seatRearMiddleHeat',
  '10/1': 'seatRearRightHeat',
  '10/2': 'seatRearRightVent',
  '11/1': 'seatThirdRowLeftHeat',
  '12/1': 'seatThirdRowMiddleHeat',
  '13/1': 'seatThirdRowRightHeat',
  '14/1': 'wiperHeat',
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

/** `seat_conditioning_status`: an entry per surface, 1 kind, 2 position, 3 level (0 off, 1–3). */
export const seatConditioning = defineRvm({
  rvm: RVM_SEAT_CONDITIONING,
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
      2: 'Rear glass',
      3: 'Windshield',
      4: 'Side mirrors',
      5: 'Front left seat',
      6: 'Front middle seat',
      7: 'Front right seat',
      8: 'Rear left seat',
      9: 'Rear middle seat',
      10: 'Rear right seat',
      11: 'Third row left seat',
      12: 'Third row middle seat',
      13: 'Third row right seat',
      14: 'Wiper area',
    },
  },
  fieldNames: {
    '1.1': 'Surface: kind',
    '1.2': 'Surface: 1 heat, 2 vent',
    '1.3': 'Surface: level (0 off, 1–3)',
  },
});

// Probes: archived to be worked out; nothing reads them yet.
export const hvacSettings = defineRvm({
  rvm: 'comfort.cabin.hvac_settings_status',
  store: true,
  fieldNames: { '1': 'Target temperature (°C; 63.5 is HI, while defrosting)' },
});

export const climateHoldSetting = defineRvm({
  rvm: 'comfort.cabin.climate_hold_setting',
  store: true,
  fieldNames: { '1': 'Hold for (s)' },
});

export const climateHoldStatus = defineRvm({
  rvm: 'comfort.cabin.climate_hold_status',
  store: true,
  fieldNames: {
    '1': 'Status (1 unavailable, 2 off, 3 on, 4 fault)',
    '2': 'Availability (1 available, 2 controllable, 3 unavailable)',
    '3': 'Unavailable because (2 battery low, 3 fault)',
    '4.1': 'Ends (s since epoch)',
  },
});

export const cabinVentilation = defineRvm({
  rvm: 'comfort.cabin.cabin_ventilation_setting',
  store: true,
  fieldNames: { '1': 'Auto cabin ventilation' },
});

export const userModes = defineRvm({
  rvm: 'comfort.user_modes.state',
  store: true,
  fieldNames: {
    '1': 'Service mode',
    '2': 'Car wash mode',
    '3': 'Pet mode',
    '4': 'Camp mode',
    '5': 'Transport mode',
    '6': 'Climate keep',
    '7': 'Factory mode',
  },
});

export const COMFORT_RVMS = [
  cabinTemperatures,
  preconditioning,
  defrost,
  petMode,
  seatConditioning,
  hvacSettings,
  climateHoldSetting,
  climateHoldStatus,
  cabinVentilation,
  userModes,
] as const;
