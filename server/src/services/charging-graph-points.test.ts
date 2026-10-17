import { describe, expect, it } from 'vitest';
import type { ChargingGraphBar } from '../rivian/parallax/index.js';
import { graphPoints } from './charging-monitor.js';

const MIN = 60_000;
const t0 = Date.parse('2026-10-16T06:41:00Z');
const bar = (
  startMin: number,
  minutes: number,
  soc: number | null,
  powerKw: number | null,
): ChargingGraphBar => ({
  soc,
  powerKw,
  startMs: t0 + startMin * MIN,
  endMs: t0 + (startMin + minutes) * MIN,
  chargingState: 3,
});
const rows = (r: ReturnType<typeof graphPoints>) =>
  r.points.map((p) => [(p.ts.getTime() - t0) / MIN, p.powerKw, p.soc]);

describe('graphPoints', () => {
  it("puts each bar's power at its start and its SoC (the level at its end) at its end", () => {
    const result = graphPoints([bar(0, 32, 44, 7.3), bar(32, 32, 47, 7.3)], t0 + 70 * MIN);
    expect(rows(result)).toEqual([
      [0, 7.3, null],
      [32, 7.3, 44],
      [64, 7.3, 47],
    ]);
    expect(result.last?.ts.getTime()).toBe(t0 + 64 * MIN);
  });

  it('closes a running bar at the time the graph was sent', () => {
    // 11:29–12:01, sent at 11:29:34 with the level then.
    const result = graphPoints([bar(0, 32, 69, 7.4), bar(32, 32, 70, null)], t0 + 32.5 * MIN);
    expect(rows(result)).toEqual([
      [0, 7.4, null],
      [32, null, 69],
      [32.5, null, 70],
    ]);
  });

  it('draws the same steady rise from 16 and 32 minute bars', () => {
    const sent = t0 + 64 * MIN;
    const sixteen = graphPoints(
      [bar(0, 16, 45, 7.3), bar(16, 16, 47, 7.3), bar(32, 16, 48, 7.3), bar(48, 16, 50, 7.3)],
      sent,
    );
    const thirtyTwo = graphPoints([bar(0, 32, 47, 7.3), bar(32, 32, 50, 7.3)], sent);
    // No flat steps: the level only rises from one point to the next.
    for (const r of [sixteen, thirtyTwo]) {
      const socs = r.points.flatMap((p) => (p.soc == null ? [] : [p.soc]));
      expect(socs.every((s, i) => i === 0 || s > socs[i - 1]!)).toBe(true);
    }
    expect(rows(thirtyTwo).at(-1)).toEqual([64, 7.3, 50]);
    expect(rows(sixteen).at(-1)).toEqual([64, 7.3, 50]);
  });

  it("puts a bar's level on its own point when the graph is sent as it starts", () => {
    const result = graphPoints([bar(0, 16, 43, null), bar(16, 16, 44, 7.3)], t0 + 16 * MIN);
    expect(rows(result)).toEqual([[16, 7.3, 44]]);
    expect(result.last).toBeNull();
  });

  it('leaves out bars with neither reading', () => {
    expect(graphPoints([bar(0, 1, null, null)], t0 + 5 * MIN)).toEqual({ points: [], last: null });
  });
});
