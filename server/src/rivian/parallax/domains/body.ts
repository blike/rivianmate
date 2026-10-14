/**
 * `body.*`: closures and locks, read as the legacy fields they stand in
 * for. The R2 leaves those legacy fields null, so these are its only source.
 */
import { defineRvm, fieldsOrEmpty, readings, stampReadings } from '../define.js';

export const RVM_CLOSURES = 'body.closures.states';
export const RVM_LOCKS = 'body.locks.states';

/**
 * `body.closures.states` positions, as the Rivian app numbers them, from
 * community captures. 10 is the charge port; 16 is the R2's rear drop
 * glass, which has no legacy field, so it's named here in legacy's style;
 * 10000 is a stateless marker that ends every R2 frame. An R2 reports 1–5, 7 and 12–15, all closed so far, so which
 * position is which door isn't confirmed on it yet.
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

/** `body.locks.states` positions: the closures' numbering, for those that lock. */
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

/**
 * Closures: 1 open, 2 closed, 3 ajar, 4 opening, 5 closing; 0 or missing
 * means not fitted. Entries with an unknown position or state are skipped.
 */
export const closures = defineRvm({
  rvm: RVM_CLOSURES,
  group: 'vehicleState',
  maturity: 'partial',
  decode: (payload) =>
    readings((put) => {
      for (const { position, state } of entries(payload)) {
        if (position == null || !state) continue;
        if (position === CLOSURE_CHARGE_PORT) {
          put('chargePortState', CHARGE_PORT_STATES[state]);
          continue;
        }
        const key = CLOSURE_FIELDS[position];
        // Opening, closing and ajar aren't closed, as legacy reports them.
        if (key && state >= 1 && state <= 5) put(key, state === 2 ? 'closed' : 'open');
      }
    }),
  toState: stampReadings,
  stateKeys: [...Object.values(CLOSURE_FIELDS), 'chargePortState'],
  fieldNames: {
    '1.1': 'Closure: position',
    '1.2': 'Closure: state (1 open, 2 closed, 3 ajar, 4 opening, 5 closing)',
  },
});

/** Locks: 1 locked, 2 unlocked, 3 partly unlocked. */
export const locks = defineRvm({
  rvm: RVM_LOCKS,
  group: 'vehicleState',
  maturity: 'partial',
  decode: (payload) =>
    readings((put) => {
      for (const { position, state } of entries(payload)) {
        const key = position == null ? undefined : LOCK_FIELDS[position];
        if (key && state != null && state >= 1 && state <= 3) {
          put(key, state === 1 ? 'locked' : 'unlocked');
        }
      }
    }),
  toState: stampReadings,
  stateKeys: Object.values(LOCK_FIELDS),
  fieldNames: {
    '1.1': 'Lock: position',
    '1.2': 'Lock: state (1 locked, 2 unlocked, 3 partly unlocked)',
  },
});

export const BODY_RVMS = [closures, locks] as const;
