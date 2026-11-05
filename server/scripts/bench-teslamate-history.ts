/**
 * Times every call the History page makes for a TeslaMate car over a window,
 * against a real TeslaMate database:
 *   TESLAMATE_URL=postgres://… node --import tsx scripts/bench-teslamate-history.ts [days] [runs]
 */
import { LiveBus } from '../src/services/live-bus.js';
import { DEFAULT_CHARGING } from '../src/services/locations.js';
import { TeslaMateSource } from '../src/teslamate/source.js';

const url = process.env.TESLAMATE_URL;
if (!url) throw new Error('Set TESLAMATE_URL');
const days = Number(process.argv[2] ?? 365);
const runs = Number(process.argv[3] ?? 2);
const places = { settings: DEFAULT_CHARGING, locations: [], wallboxes: [] };

const source = new TeslaMateSource(new LiveBus());
await source.configure(url);
const vehicles = source.getVehicles();
if (vehicles.length === 0) throw new Error(`No cars: ${source.status().error}`);

// Ends where the data does, so a stale copy still has a full window.
const end = new Date(process.env.BENCH_TO ?? Date.now());
const from = new Date(end.getTime() - days * 86_400_000);

async function time<T>(label: string, run: () => Promise<T>): Promise<number> {
  const started = performance.now();
  const result = await run();
  const ms = performance.now() - started;
  const json = JSON.stringify(result);
  const rows = Array.isArray(result) ? `${result.length} rows, ` : '';
  console.log(
    `  ${label.padEnd(18)} ${ms.toFixed(0).padStart(6)} ms  ${rows}${(json.length / 1e6).toFixed(2)} MB`,
  );
  return ms;
}

for (const v of vehicles) {
  for (let run = 1; run <= runs; run++) {
    console.log(`${v.name} (${v.id}), ${days} days, run ${run}`);
    const window = { from, to: end, limit: 5000 };
    const calls: [string, () => Promise<unknown>][] = [
      ['drives', () => source.drives(v.id, places, window)],
      ['chargingSessions', () => source.chargingSessions(v.id, places, window)],
      ['driveCoverage', () => source.driveCoverage(v.id)],
      ['batteryWindow', () => source.batteryWindow(v.id, from, end)],
      ['chargeSpans', () => source.chargeSpans(v.id, from, end)],
      ['stateSpans', () => source.stateSpans(v.id, from, end)],
      ['locations', () => source.locations(v.id, from, end)],
      ...(['battery', 'range', 'mileage'] as const).map(
        (metric) =>
          [
            `history ${metric}`,
            () => source.history(v.id, { metric, from, to: end, bucket: '1h' }),
          ] as [string, () => Promise<unknown>],
      ),
    ];
    // One at a time, to see each; then all at once, as the page asks.
    let total = 0;
    for (const [label, call] of calls) total += await time(label, call);
    const started = performance.now();
    await Promise.all(calls.map(([, call]) => call()));
    console.log(
      `  sum ${total.toFixed(0)} ms; all at once ${(performance.now() - started).toFixed(0)} ms`,
    );
  }
}
await source.stop();
