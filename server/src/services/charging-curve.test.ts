import { describe, expect, it } from 'vitest';
import {
  type CurvePoint,
  type CurveSource,
  clipToCharging,
  curveForDisplay,
  estimatedForecast,
  liveCurvePoint,
  forecastForDisplay,
  minuteSamples,
  observedCurve,
  withOpeningSoc,
} from './charging-curve.js';

const p = (
  source: CurveSource,
  ts: string,
  powerKw: number | null,
  soc: number | null,
): CurvePoint => ({
  source,
  ts: new Date(ts),
  powerKw,
  soc,
});

describe('curveForDisplay', () => {
  it('drops points whose SoC fell further than charging allows (a real DC session)', () => {
    // Recorded before sources were kept apart: stray 0 kW points at an
    // older SoC interleaved with the real readings.
    const rows = [
      p('legacy', '2026-10-02T23:10:56.908Z', 0, 58),
      p('legacy', '2026-10-02T23:10:57.708Z', 124.7, 63),
      p('legacy', '2026-10-02T23:11:01.172Z', 0, 57),
      p('legacy', '2026-10-02T23:11:01.572Z', 124.7, 64),
      p('legacy', '2026-10-02T23:11:05.840Z', 124.7, 64),
      p('legacy', '2026-10-02T23:11:07.572Z', 0, 55),
      p('legacy', '2026-10-02T23:11:16.248Z', 0, 54),
      p('legacy', '2026-10-02T23:11:22.508Z', 0, 55),
      p('legacy', '2026-10-02T23:12:25.038Z', 109.8, 66),
      p('legacy', '2026-10-02T23:12:27.208Z', 109.8, 66),
    ];
    const curve = curveForDisplay(rows);
    expect(curve.map((r) => r.powerKw)).toEqual([0, 124.7, 124.7, 124.7, 109.8, 109.8]);
    expect(curve.map((r) => r.soc)).toEqual([58, 63, 64, 64, 66, 66]);
  });

  it("draws one source, never an interleaving, preferring the vehicle's graph", () => {
    const rows = [
      p('push_live', '2026-10-02T23:00:01Z', 120, null),
      p('graph', '2026-10-02T23:00:00Z', 118, 50),
      p('push_chart', '2026-10-02T23:00:30Z', 119, 51),
      p('graph', '2026-10-02T23:01:00Z', 117, 52),
      p('push_live', '2026-10-02T23:01:01Z', 121, null),
    ];
    const curve = curveForDisplay(rows);
    expect(curve.every((r) => r.source === 'graph')).toBe(true);
    expect(curve).toHaveLength(2);
  });

  it('falls back when a source has no power readings', () => {
    const rows = [
      p('graph', '2026-10-02T23:00:00Z', null, 50),
      p('graph', '2026-10-02T23:01:00Z', null, 51),
      p('push_live', '2026-10-02T23:00:10Z', 120, null),
      p('push_live', '2026-10-02T23:00:40Z', 118, null),
    ];
    expect(curveForDisplay(rows).map((r) => r.source)).toEqual(['push_live', 'push_live']);
  });

  it('keeps SoC-only series when nothing has power, and allows a slow drop over time', () => {
    const rows = [
      p('graph', '2026-10-02T20:00:00Z', null, 80),
      // Hours later, plugged in but idle, the pack has drifted down: real.
      p('graph', '2026-10-02T23:00:00Z', null, 76),
    ];
    expect(curveForDisplay(rows).map((r) => r.soc)).toEqual([80, 76]);
  });

  it('is empty without points', () => {
    expect(curveForDisplay([])).toEqual([]);
  });
});

describe('curveForDisplay: forecasts stored as readings', () => {
  it("drops a tail where SoC keeps rising without power (an L2 session's stored forecast)", () => {
    const rows = [
      p('graph', '2026-10-03T19:58:00Z', 107, 54),
      p('graph', '2026-10-03T20:00:00Z', 111, 57),
      p('graph', '2026-10-03T20:04:00Z', 99, 60),
      // Stored before forecasts were kept apart: no power, SoC still climbing.
      p('graph', '2026-10-03T20:08:00Z', null, 63),
      p('graph', '2026-10-03T20:12:00Z', null, 66),
      p('graph', '2026-10-03T20:15:00Z', null, 70),
    ];
    expect(curveForDisplay(rows).map((r) => r.soc)).toEqual([54, 57, 60]);
  });

  it('keeps an idle tail after the charge finished (no power, SoC flat)', () => {
    const rows = [
      p('graph', '2026-10-03T19:00:00Z', 11, 80),
      p('graph', '2026-10-03T20:00:00Z', 11, 90),
      p('graph', '2026-10-03T21:00:00Z', 0, 90),
      p('graph', '2026-10-03T23:00:00Z', null, 89),
    ];
    expect(curveForDisplay(rows)).toHaveLength(4);
  });
});

describe('forecastForDisplay', () => {
  const recorded = [
    p('graph', '2026-10-03T20:00:00Z', 110, 57),
    p('graph', '2026-10-03T20:05:00Z', 100, 61),
  ];
  const rows = [
    ...recorded,
    p('forecast', '2026-10-03T20:04:00Z', null, 60), // overlaps what's recorded
    p('forecast', '2026-10-03T20:20:00Z', null, 70),
    p('forecast', '2026-10-03T20:10:00Z', null, 65),
  ];

  it('returns the forecast after the last recorded point, in time order', () => {
    expect(forecastForDisplay(rows, recorded, true).map((r) => r.soc)).toEqual([65, 70]);
  });

  it('is empty once the charge has ended', () => {
    expect(forecastForDisplay(rows, recorded, false)).toEqual([]);
  });

  it('is never chosen as the recorded curve', () => {
    expect(curveForDisplay(rows).every((r) => r.source === 'graph')).toBe(true);
  });
});

describe('estimatedForecast', () => {
  const at = (iso: string, value: number | null) => ({ value, updatedAt: iso });
  const live = {
    soc: at('2026-10-16T08:00:00Z', 50),
    socLimit: at('2026-10-16T02:00:00Z', 70),
    timeRemaining: at('2026-10-16T08:00:30Z', 150 * 60),
  };

  it('runs from the level now to the limit when the time left runs out', () => {
    expect(estimatedForecast(live).map((p) => [p.ts.toISOString(), p.soc])).toEqual([
      ['2026-10-16T08:00:00.000Z', 50],
      ['2026-10-16T10:30:30.000Z', 70],
    ]);
  });

  it('has none without every reading, at the limit, or with an implausible time left', () => {
    expect(estimatedForecast(null)).toEqual([]);
    expect(estimatedForecast({ ...live, socLimit: null })).toEqual([]);
    expect(estimatedForecast({ ...live, timeRemaining: at('2026-10-16T08:00:30Z', null) })).toEqual(
      [],
    );
    expect(estimatedForecast({ ...live, soc: at('2026-10-16T08:00:00Z', 70) })).toEqual([]);
    expect(
      estimatedForecast({ ...live, timeRemaining: at('2026-10-16T08:00:30Z', 72 * 3600) }),
    ).toEqual([]);
  });
});

describe('liveCurvePoint', () => {
  const last: CurvePoint = {
    source: 'graph',
    ts: new Date('2026-10-16T09:21:03Z'),
    powerKw: 7.4,
    soc: 56,
  };
  const live = {
    soc: { value: 59.3, updatedAt: '2026-10-16T09:52:10Z' },
    power: { value: 7.4, updatedAt: '2026-10-16T09:51:00Z' },
  };

  it('closes the recorded curve at the live level and power', () => {
    expect(liveCurvePoint(live, last)).toEqual({
      source: 'graph',
      ts: new Date('2026-10-16T09:52:10Z'),
      powerKw: 7.4,
      soc: 59.3,
    });
  });

  it('has none without a level, or when the curve is already as new', () => {
    expect(liveCurvePoint(null, last)).toBeNull();
    expect(liveCurvePoint({ ...live, soc: null }, last)).toBeNull();
    expect(
      liveCurvePoint({ ...live, soc: { value: 56, updatedAt: '2026-10-16T09:21:03Z' } }, last),
    ).toBeNull();
  });
});

describe('clipToCharging', () => {
  // Pacific times from Oct 15–16, 2026: 32-minute bars, charging 23:59:59–04:39:40.
  const at = (hhmm: string) => new Date(`2026-10-16T${hhmm}:00Z`);
  const p = (hhmm: string, powerKw: number | null, soc: number): CurvePoint => ({
    source: 'graph',
    ts: at(hhmm),
    powerKw,
    soc,
  });
  const graph = [
    p('06:09', null, 43),
    p('06:41', 7.3, 43),
    p('07:13', 7.3, 44),
    p('10:57', 7.4, 66),
    p('11:29', null, 69),
    p('12:01', null, 70),
  ];
  const window = { from: new Date('2026-10-16T06:59:59Z'), to: new Date('2026-10-16T11:39:40Z') };

  it('starts where charging started and ends where it stopped, at the level then', () => {
    expect(
      clipToCharging(graph, window).map((q) => [q.ts.toISOString(), q.powerKw, q.soc]),
    ).toEqual([
      ['2026-10-16T06:59:59.000Z', 7.3, 43],
      ['2026-10-16T07:13:00.000Z', 7.3, 44],
      ['2026-10-16T10:57:00.000Z', 7.4, 66],
      // The last bar's power, which Rivian leaves off once charging stops.
      ['2026-10-16T11:29:00.000Z', 7.4, 69],
      ['2026-10-16T11:39:40.000Z', 7.4, 70],
    ]);
  });

  it('leaves the curve as is without a charging window', () => {
    expect(clipToCharging(graph, null)).toEqual(graph);
  });

  it('is applied before the display checks, so the end of the charge stays', () => {
    expect(curveForDisplay(graph, window).map((q) => [q.ts.getTime(), q.soc])).toEqual(
      clipToCharging(graph, window).map((q) => [q.ts.getTime(), q.soc]),
    );
  });
});

describe('withOpeningSoc', () => {
  it("fills the first point's missing SoC with the level it charged from", () => {
    // Rivian's first graph bar: power at the plug-in moment, no battery level.
    const curve = [
      p('graph', '2026-10-18T06:59:00Z', 7.3, null),
      p('graph', '2026-10-18T07:27:31Z', 7.4, 52),
    ];
    expect(withOpeningSoc(curve, 48.7)).toEqual([
      p('graph', '2026-10-18T06:59:00Z', 7.3, 48.7),
      curve[1],
    ]);
  });

  it('keeps a recorded first SoC, and an unknown level changes nothing', () => {
    const recorded = [p('graph', '2026-10-18T06:59:00Z', 7.3, 49)];
    expect(withOpeningSoc(recorded, 48.7)).toEqual(recorded);
    const missing = [p('graph', '2026-10-18T06:59:00Z', 7.3, null)];
    expect(withOpeningSoc(missing, null)).toEqual(missing);
    expect(withOpeningSoc([], 48.7)).toEqual([]);
  });
});

describe('observedCurve', () => {
  it('fills only the stretch without samples from the recorded series', () => {
    const observed = [
      p('observed', '2026-10-20T07:00:00Z', 7.3, 50),
      p('observed', '2026-10-20T07:01:00Z', 7.3, 50.1),
      // The app was down from 07:01 to 08:00.
      p('observed', '2026-10-20T08:00:00Z', 7.4, 56),
    ];
    const graph = [
      p('graph', '2026-10-20T07:02:00Z', 7.3, 50),
      p('graph', '2026-10-20T07:30:00Z', 7.3, 53),
      p('graph', '2026-10-20T07:58:00Z', 7.4, 55),
    ];
    expect(observedCurve(observed, graph).map((r) => [r.source, r.soc])).toEqual([
      ['observed', 50],
      ['observed', 50.1],
      ['graph', 53],
      ['observed', 56],
    ]);
  });

  it('drops an implausible level among its own samples', () => {
    const observed = [
      p('observed', '2026-10-20T07:00:00Z', 7.3, 50),
      p('observed', '2026-10-20T07:01:00Z', 7.3, 12),
      p('observed', '2026-10-20T07:02:00Z', null, 50.2),
    ];
    expect(observedCurve(observed, []).map((r) => r.soc)).toEqual([50, 50.2]);
  });
});

describe('minuteSamples', () => {
  const at = (iso: string) => Date.parse(iso);
  const span = { from: new Date('2026-10-20T07:00:00Z'), to: new Date('2026-10-20T07:02:30Z') };

  it('samples each minute and the end with the latest readings', () => {
    const samples = minuteSamples(
      [
        { at: at('2026-10-20T06:30:00Z'), field: 'soc', value: 50 },
        { at: at('2026-10-20T07:00:20Z'), field: 'powerKw', value: 7.3 },
        { at: at('2026-10-20T07:01:40Z'), field: 'soc', value: 50.2 },
      ],
      [span],
    );
    expect(samples.map((s) => [s.ts.toISOString().slice(11, 19), s.powerKw, s.soc])).toEqual([
      ['07:00:00', null, 50],
      ['07:01:00', 7.3, 50],
      ['07:02:00', 7.3, 50.2],
      ['07:02:30', 7.3, 50.2],
    ]);
  });

  it('ignores power from before the span and lets it go stale', () => {
    const samples = minuteSamples(
      [{ at: at('2026-10-20T06:59:00Z'), field: 'powerKw', value: 7.3 }],
      [span],
    );
    expect(samples).toEqual([]);
    const stale = minuteSamples(
      [{ at: at('2026-10-20T07:00:00Z'), field: 'powerKw', value: 7.3 }],
      [{ from: span.from, to: new Date('2026-10-20T07:08:00Z') }],
    );
    expect(stale.map((s) => s.powerKw)).toEqual([7.3, 7.3, 7.3, 7.3, 7.3, 7.3]);
  });
});

describe('curveForDisplay with an ElectraFi series', () => {
  const series = (source: CurvePoint['source'], powerKw: number): CurvePoint[] =>
    [0, 60_000, 120_000].map((offset, i) => ({
      source,
      ts: new Date(Date.parse('2026-05-01T10:00:00Z') + offset),
      powerKw,
      soc: 50 + i,
    }));

  it('draws it when nothing better was recorded', () => {
    expect(curveForDisplay(series('electrafi', 6)).map((p) => p.source)).toEqual([
      'electrafi',
      'electrafi',
      'electrafi',
    ]);
  });

  it("prefers the vehicle's own graph", () => {
    const curve = curveForDisplay([...series('electrafi', 6), ...series('graph', 7)]);
    expect(new Set(curve.map((p) => p.source))).toEqual(new Set(['graph']));
  });
});
