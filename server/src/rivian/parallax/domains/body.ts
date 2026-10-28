/** `body.*`: closures, locks and washer fluid, as legacy fields (an R2's only source of them). */
import { defineRvm, fieldsOrEmpty, readings, stampReadings } from '../define.js';

export const RVM_CLOSURES = 'body.closures.states';
export const RVM_LOCKS = 'body.locks.states';

/**
 * `body.closures.states` positions. 10 is the charge port, 16 the R2's rear
 * glass (no legacy field, so named in its style), and 10000 all windows
 * together (not read).
 */
const CLOSURE_FIELDS: Record<number, string> = {
  1: 'doorFrontLeftClosed',
  2: 'doorFrontRightClosed',
  3: 'doorRearLeftClosed',
  4: 'doorRearRightClosed',
  5: 'closureFrunkClosed',
  6: 'closureTailgateClosed',
  7: 'closureLiftgateClosed',
  8: 'closureSideBinLeftClosed',
  9: 'closureSideBinRightClosed',
  11: 'closureTonneauClosed',
  12: 'windowFrontLeftClosed',
  13: 'windowFrontRightClosed',
  14: 'windowRearLeftClosed',
  15: 'windowRearRightClosed',
  16: 'windowRearGlassClosed',
};
const CLOSURE_CHARGE_PORT = 10;

/** What each position is, as the dashboard names it, for the feed viewer. */
const POSITION_LABELS: Record<number, string> = {
  1: 'Driver door',
  2: 'Passenger door',
  3: 'Rear left door',
  4: 'Rear right door',
  5: 'Frunk',
  6: 'Tailgate',
  7: 'Liftgate',
  8: 'Gear tunnel L',
  9: 'Gear tunnel R',
  10: 'Charge port',
  11: 'Tonneau',
  12: 'Window FL',
  13: 'Window FR',
  14: 'Window RL',
  15: 'Window RR',
  16: 'Rear glass',
  10000: 'Any window (R1S)',
};

/**
 * `body.locks.states` positions: the closures' numbering up to 9, then
 * their own. 10–13 have no legacy fields, so they're named in its style.
 */
const LOCK_FIELDS: Record<number, string> = {
  1: 'doorFrontLeftLocked',
  2: 'doorFrontRightLocked',
  3: 'doorRearLeftLocked',
  4: 'doorRearRightLocked',
  5: 'closureFrunkLocked',
  6: 'closureTailgateLocked',
  7: 'closureLiftgateLocked',
  8: 'closureSideBinLeftLocked',
  9: 'closureSideBinRightLocked',
  10: 'closureChargePortLocked',
  11: 'closureTrunkSecurityLocked',
  12: 'closureCenterConsoleLocked',
  13: 'closureGloveBoxLocked',
  14: 'gearGuardLocked',
  15: 'closureTonneauLocked',
};

/** What each lock position is, for the feed viewer. */
const LOCK_LABELS: Record<number, string> = {
  ...Object.fromEntries(Object.entries(POSITION_LABELS).filter(([p]) => Number(p) <= 9)),
  10: 'Charge port',
  11: 'Trunk security',
  12: 'Center console',
  13: 'Glove box',
  14: 'Gear Guard cable',
  15: 'Tonneau',
};

/** Legacy chargePortState for a closure state; it has no ajar, so ajar reads as open. */
const CHARGE_PORT_STATES: Record<number, string> = {
  1: 'open',
  2: 'close',
  3: 'open',
  4: 'opening',
  5: 'closing',
};

/** Repeated field 1, each with 1 position and 2 state; none if the payload isn't protobuf. */
function entries(payloadBase64: string) {
  return (fieldsOrEmpty(payloadBase64)?.repeated(1) ?? []).map((e) => ({
    position: e.int(1),
    state: e.int(2),
  }));
}

/** Doors and windows: read only as open or closed, all they've ever sent. */
const OPEN_CLOSED_POSITIONS = new Set([1, 2, 3, 4, 12, 13, 14, 15, 16]);

/** Closures: 1 open, 2 closed, 3 ajar, 4 opening, 5 closing; 0 or missing is not fitted. */
export const closures = defineRvm({
  rvm: RVM_CLOSURES,
  group: 'vehicleState',
  decode: (payload) =>
    readings((put) => {
      for (const { position, state } of entries(payload)) {
        if (position == null || !state) continue;
        if (position === CLOSURE_CHARGE_PORT) {
          put('chargePortState', CHARGE_PORT_STATES[state]);
          continue;
        }
        const key = CLOSURE_FIELDS[position];
        const known = state >= 1 && state <= (OPEN_CLOSED_POSITIONS.has(position) ? 2 : 5);
        // Opening, closing and ajar aren't closed, as legacy reports them.
        if (key && known) put(key, state === 2 ? 'closed' : 'open');
      }
    }),
  toState: stampReadings,
  stateKeys: [...Object.values(CLOSURE_FIELDS), 'chargePortState'],
  entryLabels: { field: 1, key: 1, labels: POSITION_LABELS },
  // 3–11 aren't read: legacy has no fields for them.
  fieldNames: {
    '1.1': 'Closure: position',
    '1.2': 'Closure: state (1 open, 2 closed, 3 ajar, 4 opening, 5 closing)',
    '1.3': 'Closure: open (%)',
    '1.4': 'Closure: fault (1 none, 2 general, 3 no powered operation, 4 obstructed)',
    '1.5': 'Windows: next action (1 can open, 2 can close, 3 opening, 4 closing…)',
    '1.6': 'Frunk: next action (1 can open, 2 can close, 3 opening, 4 closing…)',
    '1.7': 'Liftgate: next action (1 can open, 2 can close, 3 opening, 4 closing…)',
    '1.8': 'Gear tunnel: next action (1 can open, 2 opening…)',
    '1.9': 'Tailgate: next action (1 can open, 2 opening…)',
    '1.10':
      'Charge port: next action (1 can open, 4 opening, 5 can close, 9 plugged in, 11 closing…)',
    '1.11': 'Tonneau: next action',
  },
});

/** Locks: 1 locked, 2 unlocked, 3 partly unlocked, read as unlocked (legacy has only two). */
export const locks = defineRvm({
  rvm: RVM_LOCKS,
  group: 'vehicleState',
  decode: (payload) =>
    readings((put) => {
      for (const { position, state } of entries(payload)) {
        const key = position == null ? undefined : LOCK_FIELDS[position];
        if (key && state && state <= 3) put(key, state === 1 ? 'locked' : 'unlocked');
      }
    }),
  toState: stampReadings,
  stateKeys: Object.values(LOCK_FIELDS),
  entryLabels: { field: 1, key: 1, labels: LOCK_LABELS },
  fieldNames: {
    '1.1': 'Lock: position',
    '1.2': 'Lock: state (1 locked, 2 unlocked, 3 partly unlocked)',
    '1.3': 'Lock: fault (1 faulted)',
  },
});

const WASHER_FLUID: Record<number, string> = { 1: 'normal', 2: 'low', 3: 'empty' };

/** `body.wipers.fluid_level`: 2 level (1 normal, 2 low, 3 empty), as legacy wiperFluidState. */
export const washerFluid = defineRvm({
  rvm: 'body.wipers.fluid_level',
  group: 'vehicleState',
  decode: (payload) =>
    readings((put) => put('wiperFluidState', WASHER_FLUID[fieldsOrEmpty(payload)?.int(2) ?? 0])),
  toState: stampReadings,
  stateKeys: ['wiperFluidState'],
  store: true,
  fieldNames: { '2': 'Washer fluid (1 normal, 2 low, 3 empty)' },
});

// Probes: archived to be worked out; nothing reads them yet.
export const windowCalibration = defineRvm({
  rvm: 'body.windows.states',
  group: 'vehicleState',
  store: true,
  fieldNames: {
    '1.1': 'Window (1 FL, 2 FR, 3 RL, 4 RR, 5 rear)',
    '1.2': 'Window: calibrated (1 yes, 2 no)',
  },
});

export const trailer = defineRvm({
  rvm: 'body.trailer.state',
  group: 'vehicleState',
  store: true,
  fieldNames: {
    '1': 'Trailer (1 none, 2 connected, 3 with brakes, 4 invalid)',
    '2': 'Hitch (1 none, 2 accessory, 3–5 trailer profiles)',
  },
});

export const BODY_RVMS = [closures, locks, windowCalibration, trailer, washerFluid] as const;
