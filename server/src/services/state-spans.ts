/** What the vehicle was doing over time: driving, charging, awake or asleep. */
import type { Db } from '../db/client.js';
import type { VehicleState } from '../rivian/types.js';
import { stateTimeline } from './state-history.js';
import { stateString } from './state-utils.js';

export type VehicleActivity = 'driving' | 'charging' | 'updating' | 'awake' | 'asleep';

const ACTIVITY_FIELDS = ['powerState', 'gearStatus', 'chargerStatus'];

export interface ActivityChange {
  ts: Date;
  state: VehicleActivity;
}

export interface StateSpan {
  state: VehicleActivity;
  from: Date;
  to: Date;
}

/**
 * Spans within [from, to] from state changes in time order. Each state
 * holds until the next change; the last one holds until `to`. A change
 * before `from` sets the state the window opens with.
 */
export function stateSpans(changes: readonly ActivityChange[], from: Date, to: Date): StateSpan[] {
  const spans: StateSpan[] = [];
  for (let i = 0; i < changes.length; i++) {
    const { state } = changes[i]!;
    const start = Math.max(changes[i]!.ts.getTime(), from.getTime());
    const end = Math.min(changes[i + 1]?.ts.getTime() ?? to.getTime(), to.getTime());
    if (end <= start) continue;
    const prev = spans[spans.length - 1];
    if (prev && prev.state === state && prev.to.getTime() === start) prev.to = new Date(end);
    else spans.push({ state, from: new Date(start), to: new Date(end) });
  }
  return spans;
}

/** What the vehicle was doing given its state; null when power state isn't known. */
export function activityOf(state: VehicleState): VehicleActivity | null {
  const power = stateString(state, 'powerState');
  if (power === 'ota_update') return 'updating';
  const gear = stateString(state, 'gearStatus');
  if (gear === 'drive' || gear === 'reverse') return 'driving';
  if (stateString(state, 'chargerStatus') === 'chrgr_sts_connected_charging') return 'charging';
  if (power === 'sleep' || power === 'standby') return 'asleep';
  return power != null ? 'awake' : null;
}

/**
 * State spans for a vehicle over [from, to], from recorded state history.
 * At each change the state is the first that applies of: updating
 * software, in drive or reverse, charging, asleep (sleep or standby), else
 * awake. The state held at `from` opens the window.
 */
export async function loadStateSpans(
  db: Db,
  vehicleId: string,
  from: Date,
  to: Date,
): Promise<StateSpan[]> {
  const entries = await stateTimeline(db, vehicleId, ACTIVITY_FIELDS, from, to);
  return stateSpans(
    entries.flatMap((e) => {
      const state = activityOf(e.state);
      return state ? [{ ts: new Date(e.at), state }] : [];
    }),
    from,
    new Date(Math.min(to.getTime(), Date.now())),
  );
}
