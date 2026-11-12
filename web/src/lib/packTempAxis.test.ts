import { describe, expect, it } from 'vitest';
import { packTempAxis, packTempTickStep, packTempTicks } from './packTempAxis';

/**
 * The pack temperatures a chart drew, in the unit read: the average, and the
 * band's two ends. `MEASURED_F` is the 31 Oct drive as the car recorded it — 68.7
 * to 78.1 °F, the session that reported a 50…90 frame. `DC_F` is a real DC fast
 * charge: the pack moves 40 °C, 72 °F.
 */
const MEASURED_F = [68.72, 78.08];
const DC_F = [39, 111];
const DC_C = [10, 50];
/** FLAT is a short top-up in a cold garage: five and a half degrees drawn. */
const FLAT_C = [20.6, 26.7, 21.6, 23.1, 24.6];
const FLAT_F = [69.1, 80.1, 73.6];

describe('packTempAxis', () => {
  it('gives the measured 9 °F drive a 60 to 85 frame, ticked every five', () => {
    // Nine drawn, five of air a side is 19, under the 20 °F floor: it holds the
    // frame, centred on 72.5 and snapped out to the 5 °F grid.
    const [low, high] = packTempAxis(MEASURED_F, 'F');

    expect([low, high]).toEqual([60, 85]);
    expect(high - low).toBe(25);
    expect(low).toBeLessThanOrEqual(68.72);
    expect(high).toBeGreaterThanOrEqual(78.08);
    // Twenty-five is under the forty a ten-degree interval needs.
    expect(packTempTicks([low, high], 'F')).toEqual([60, 65, 70, 75, 80, 85]);
  });

  it('gives a 24 °F move a 30 to 70 frame: a quarter of it each side', () => {
    // 24 drawn, six of air either side, centred on 52 and snapped out.
    const [low, high] = packTempAxis([40, 64], 'F');

    expect([low, high]).toEqual([30, 70]);
    // The frame the padding asks for is 36; the grid takes it to 40.
    expect(high - low).toBe(40);
    // Wide enough for ten-degree ticks and no wider.
    expect(packTempTicks([low, high], 'F')).toEqual([30, 40, 50, 60, 70]);
  });

  it('holds a 4 °F move at the 20 °F floor rather than drawing a frame of nothing', () => {
    const [low, high] = packTempAxis([68, 72], 'F');

    expect([low, high]).toEqual([60, 80]);
    expect(high - low).toBe(20);
    // The readings are a fifth of it, so they read as a band rather than a line.
    expect(4 / (high - low)).toBeLessThanOrEqual(1 / 3);
    expect(low).toBeLessThanOrEqual(68);
    expect(high).toBeGreaterThanOrEqual(72);
  });

  it('gives a 72 °F DC swing 108 °F, with both ends of the readings inside it', () => {
    const [low, high] = packTempAxis(DC_F, 'F');

    // 72 drawn, 18 of air either side, centred on 75 and snapped out to 20…130.
    expect([low, high]).toEqual([20, 130]);
    expect(high - low).toBe(110);
    // No cap: the padding alone is what keeps a swing this wide readable, and
    // every reading sits a whole step or more inside the frame.
    expect(DC_F[0]! - low).toBeGreaterThanOrEqual(18);
    expect(high - DC_F[1]!).toBeGreaterThanOrEqual(18);
  });

  it('holds a drawn range wider than the old 90 °F cap, rather than clipping it', () => {
    // A hundred degrees drawn would have been clamped to 90 by the cap and cut
    // at both ends, since the frame is centred on the readings it holds.
    const [low, high] = packTempAxis([0, 100], 'F');

    expect([low, high]).toEqual([-25, 125]);
    expect(high - low).toBeGreaterThan(90);
    expect(low).toBeLessThanOrEqual(0);
    expect(high).toBeGreaterThanOrEqual(100);
  });

  it('never excludes a reading, over a sweep of extents and positions', () => {
    for (let drawn = 0; drawn <= 120; drawn++) {
      for (const middle of [70, 72.5, 75, 77.5]) {
        const values = [middle - drawn / 2, middle + drawn / 2];
        const [low, high] = packTempAxis(values, 'F');

        expect(low).toBeLessThanOrEqual(values[0]!);
        expect(high).toBeGreaterThanOrEqual(values[1]!);
        // The padding is a share of the movement above the floor, plus at most a
        // step of grid at each end and a step of tick alignment — never a fixed
        // slab on a wide session, which is what a cap would have cut off instead.
        expect(high - low).toBeLessThanOrEqual(Math.max(20, 1.5 * drawn) + 15);
      }
    }
  });

  it('frames the same sessions in Celsius at half the numbers', () => {
    // Five degrees drawn: a quarter is 1.3, under the three degrees of air the
    // minimum gives, and 5.2 + 6 is just over the 11 °C floor.
    expect(packTempAxis([20.4, 25.6], 'C')).toEqual([15, 30]);
    // Ten degrees drawn, clear of the floor: 10 + 6, centred on 17 and snapped.
    const [lowC, highC] = packTempAxis([12, 22], 'C');
    expect([lowC, highC]).toEqual([7.5, 25]);
    expect(highC - lowC).toBe(17.5);
    // The same DC swing: 40 drawn, ten of air either side, and no cap to hold it.
    const [low, high] = packTempAxis(DC_C, 'C');
    expect([low, high]).toEqual([0, 60]);
    expect(low).toBeLessThanOrEqual(10);
    expect(high).toBeGreaterThanOrEqual(50);
  });

  it('centres the frame on the readings it holds', () => {
    const [low, high] = packTempAxis(FLAT_C, 'C');
    const middle = (Math.min(...FLAT_C) + Math.max(...FLAT_C)) / 2;

    // The frame's own middle is the readings' middle, give or take the grid.
    expect((low + high) / 2).toBeGreaterThanOrEqual(middle - 2.5);
    expect((low + high) / 2).toBeLessThanOrEqual(middle + 2.5);

    const [lowF, highF] = packTempAxis(FLAT_F, 'F');
    const middleF = (Math.min(...FLAT_F) + Math.max(...FLAT_F)) / 2;
    expect(lowF + highF).toBeGreaterThanOrEqual(2 * middleF - 5);
    expect(lowF + highF).toBeLessThanOrEqual(2 * middleF + 5);
  });

  it('snaps the bounds outward to the fine grid, in the unit read', () => {
    // Celsius bounds on the 2.5 °C grid, Fahrenheit on the 5 °F one — the coarse
    // 10 °F grid is what inflated the measured drive's 29 °F frame to 40.
    const [lowC, highC] = packTempAxis(FLAT_C, 'C');
    expect([lowC % 2.5, highC % 2.5]).toEqual([0, 0]);

    const [lowF, highF] = packTempAxis(FLAT_F, 'F');
    expect([lowF % 5, highF % 5]).toEqual([0, 0]);
    expect(lowF).toBeLessThanOrEqual(69.1);
    expect(highF).toBeGreaterThanOrEqual(80.1);
    // A multiple of five that is not a multiple of ten: the grid is the fine one.
    expect(packTempAxis(MEASURED_F, 'F')).toEqual([60, 85]);

    // The widest cases too: the grid holds there as well.
    const [lowWideC, highWideC] = packTempAxis(DC_C, 'C');
    expect([lowWideC % 2.5, highWideC % 2.5]).toEqual([0, 0]);
  });

  it('has nothing to frame without readings', () => {
    expect(packTempAxis([], 'C')).toEqual([-5, 5]);
    expect(packTempAxis([], 'F')).toEqual([-10, 10]);
    // A reading the vehicle never took is no reading.
    expect(packTempAxis([Number.NaN], 'F')).toEqual([-10, 10]);
  });
});

describe('packTempTickStep', () => {
  it('ticks a wide axis every ten degrees Fahrenheit, a narrow one every five', () => {
    expect(packTempTickStep(50, 'F')).toBe(10);
    // The frame a 24 °F move is given, at 40 °F: ten-degree ticks still.
    expect(packTempTickStep(40, 'F')).toBe(10);
    expect(packTempTickStep(39, 'F')).toBe(5);
    // The frame the measured drive is given, at 25 °F.
    expect(packTempTickStep(25, 'F')).toBe(5);
  });

  it('draws the same line in Celsius, at half the numbers', () => {
    expect(packTempTickStep(25, 'C')).toBe(5);
    expect(packTempTickStep(22, 'C')).toBe(5);
    expect(packTempTickStep(21, 'C')).toBe(2.5);
    // The frame a 5 °C session is given.
    expect(packTempTickStep(12.5, 'C')).toBe(2.5);
  });
});

describe('packTempTicks', () => {
  it('ticks a narrow frame evenly, at the five degrees its span picks', () => {
    expect(packTempTicks([60, 85], 'F')).toEqual([60, 65, 70, 75, 80, 85]);
  });

  it('ticks a wide frame evenly, at the ten degrees its span picks', () => {
    expect(packTempTicks([40, 100], 'F')).toEqual([40, 50, 60, 70, 80, 90, 100]);
    // A 72 °F charge, framed 20 to 130: twelve labels, ten apart.
    expect(packTempTicks([20, 130], 'F')).toHaveLength(12);
  });

  it('carries the half degree a narrow Celsius frame is ticked at', () => {
    expect(packTempTicks([17.5, 30], 'C')).toEqual([17.5, 20, 22.5, 25, 27.5, 30]);
    // Wide enough for whole fives, and no further.
    expect(packTempTicks([0, 60], 'C')).toHaveLength(13);
  });

  it('starts and ends on the frame’s own bounds, whatever the extent', () => {
    for (const [values, unit] of [
      [MEASURED_F, 'F'],
      [[40, 64], 'F'],
      [[0, 100], 'F'],
      [DC_F, 'F'],
      [[12, 22], 'C'],
      [DC_C, 'C'],
      [FLAT_C, 'C'],
      [FLAT_F, 'F'],
    ] as const) {
      const bounds = packTempAxis(values, unit);
      const ticked = packTempTicks(bounds, unit);
      expect(ticked[0]).toBe(bounds[0]);
      expect(ticked.at(-1)).toBe(bounds[1]);
      // Evenly spaced, and every reading inside the labels' range.
      const steps = ticked.slice(1).map((v, i) => Number((v - ticked[i]!).toFixed(2)));
      expect(new Set(steps).size).toBe(1);
      for (const value of values) {
        expect(value).toBeGreaterThanOrEqual(ticked[0]!);
        expect(value).toBeLessThanOrEqual(ticked.at(-1)!);
      }
    }
  });
});
