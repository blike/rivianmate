/** What the vehicle was doing over time: driving, charging, awake or asleep. */
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';

export type VehicleActivity = 'driving' | 'charging' | 'updating' | 'awake' | 'asleep';

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

/**
 * State spans for a vehicle over [from, to], from recorded snapshots. A
 * snapshot's state is the first that applies of: updating software, in
 * drive or reverse, charging, asleep (sleep or standby), else awake.
 * Reads only the changes, plus the last one before the window (looking back
 * up to 30 days) so it opens in the right state.
 */
export async function loadStateSpans(
  db: Db,
  vehicleId: string,
  from: Date,
  to: Date,
): Promise<StateSpan[]> {
  const rows = await db.execute<{ ts: string; state: VehicleActivity }>(sql`
    WITH states AS (
      SELECT ts, id,
             CASE
               WHEN power_state = 'ota_update' THEN 'updating'
               WHEN data->'gearStatus'->>'value' IN ('drive', 'reverse') THEN 'driving'
               WHEN charger_status = 'chrgr_sts_connected_charging' THEN 'charging'
               WHEN power_state IN ('sleep', 'standby') THEN 'asleep'
               WHEN power_state IS NOT NULL THEN 'awake'
             END AS state
      FROM vehicle_state_snapshots
      WHERE vehicle_id = ${vehicleId}
        AND ts >= ${from.toISOString()}::timestamptz - interval '30 days'
        AND ts <= ${to.toISOString()}::timestamptz
    ),
    changes AS (
      SELECT ts, state, LAG(state) OVER (ORDER BY ts, id) AS prev
      FROM states
      WHERE state IS NOT NULL
    )
    SELECT ts, state FROM (
      SELECT ts, state FROM changes
      WHERE state IS DISTINCT FROM prev AND ts < ${from.toISOString()}::timestamptz
      ORDER BY ts DESC LIMIT 1
    ) opening
    UNION ALL
    SELECT ts, state FROM changes
    WHERE state IS DISTINCT FROM prev AND ts >= ${from.toISOString()}::timestamptz
    ORDER BY ts
  `);
  return stateSpans(
    rows.map((r) => ({ ts: new Date(r.ts), state: r.state })),
    from,
    new Date(Math.min(to.getTime(), Date.now())),
  );
}
