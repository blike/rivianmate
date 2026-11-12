import { describe, expect, it } from 'vitest';
import { packTempAxis, packTempTickStep, packTempTicks } from './packTempAxis';

/**
 * The pack temperatures a chart drew, in the unit read: the average, and the
 * band's two ends. `flat` is a short top-up in a cold garage; `wide` is a long
 * charge that moves the pack 30 degrees.
 */
const FLAT_C = [20.6, 26.7, 21.6, 23.1, 24.6];
const WIDE_C = [10, 40];
const FLAT_F = [69.1, 80.1, 73.6];
/** A session that moves the pack a degree. */
const ONE_C = [24.5, 25.5];
/** A real DC fast charge: the pack moves 40 °C, which is 72 °F. */
const DC_C = [10, 50];
const DC_F = [39, 111];

describe('packTempAxis', () => {
  it('gives a session the same ten degrees Fahrenheit of air whatever it moves', () => {
    // Ten degrees drawn, and thirty: five whole steps either way, so the padding
    // shows through the snap exactly as the rule states it.
    const [tenLow, tenHigh] = packTempAxis([60, 70], 'F');
    const [thirtyLow, thirtyHigh] = packTempAxis([50, 80], 'F');

    expect([tenLow, tenHigh]).toEqual([50, 80]);
    expect(tenHigh - tenLow).toBe(10 + 2 * 10);
    expect([thirtyLow, thirtyHigh]).toEqual([40, 90]);
    expect(thirtyHigh - thirtyLow).toBe(30 + 2 * 10);
  });

  it('frames a 24 °F move at 44 °F within a step, so its labels stay put', () => {
    const [low, high] = packTempAxis([40, 64], 'F');

    // 24 + 20 of air, centred on 52, snapped out to the steps either side.
    expect([low, high]).toEqual([30, 80]);
    expect(high - low).toBeGreaterThanOrEqual(44);
    expect(high - low).toBeLessThanOrEqual(44 + 10);
    expect(low).toBeLessThanOrEqual(40);
    expect(high).toBeGreaterThanOrEqual(64);
  });

  it('holds a 10 °F move above the floor, so a flat session is not the whole plot', () => {
    const [low, high] = packTempAxis([60, 70], 'F');

    expect(high - low).toBeGreaterThanOrEqual(20);
    // The movement is a third of the frame, not all of it.
    expect(10 / (high - low)).toBeLessThanOrEqual(1 / 3);
  });

  it('caps a 72 °F charge at 90 °F, rather than a hundred-degree axis', () => {
    const [low, high] = packTempAxis(DC_F, 'F');

    // 72 + 20 of air is 92; the cap holds it to the nine steps of a whole frame.
    expect([low, high]).toEqual([30, 120]);
    expect(high - low).toBe(90);
    expect(low).toBeLessThanOrEqual(DC_F[0]!);
    expect(high).toBeGreaterThanOrEqual(DC_F[1]!);
  });

  it('holds the same charge at the Celsius cap, rather than past it', () => {
    const [low, high] = packTempAxis(DC_C, 'C');

    // 40 + 10 of air is the cap exactly: ten whole steps of five.
    expect([low, high]).toEqual([5, 55]);
    expect(high - low).toBe(50);
  });

  it('frames the same session in Celsius at half the numbers', () => {
    // Ten degrees drawn and five of air either side, on steps of five.
    const [lowC, highC] = packTempAxis([10, 20], 'C');
    expect([lowC, highC]).toEqual([5, 25]);
    expect(highC - lowC).toBe(10 + 2 * 5);
  });

  it('keeps a session that moves a degree off the floor’s edge, in the unit read', () => {
    const [low, high] = packTempAxis(ONE_C, 'C');

    // One degree in a frame of twenty at least is a twentieth of the plot.
    expect([low, high]).toEqual([15, 35]);
    expect(high - low).toBeGreaterThanOrEqual(11);
    expect(low).toBeLessThanOrEqual(24.5);
    expect(high).toBeGreaterThanOrEqual(25.5);
  });

  it('centres the frame on the readings it holds', () => {
    const [low, high] = packTempAxis(FLAT_C, 'C');

    // The readings run 20.6 to 26.7; the frame is the nearest whole steps out.
    expect([low, high]).toEqual([15, 35]);
    expect((low + high) / 2).toBeGreaterThanOrEqual(20.6);
    expect((low + high) / 2).toBeLessThanOrEqual(26.7);
  });

  it('snaps the bounds outward to whole steps, in the unit read', () => {
    const [lowC, highC] = packTempAxis(FLAT_C, 'C');
    expect([lowC % 5, highC % 5]).toEqual([0, 0]);

    const [lowF, highF] = packTempAxis(FLAT_F, 'F');
    expect([lowF % 10, highF % 10]).toEqual([0, 0]);
    expect(lowF).toBeLessThanOrEqual(69.1);
    expect(highF).toBeGreaterThanOrEqual(80.1);

    // The capped cases too: snapping only widens, so it never cuts a reading.
    const [lowWideC, highWideC] = packTempAxis(WIDE_C, 'C');
    expect([lowWideC % 5, highWideC % 5]).toEqual([0, 0]);
    expect([lowWideC, highWideC]).toEqual([5, 45]);

    const [lowCappedF, highCappedF] = packTempAxis(DC_F, 'F');
    expect([lowCappedF % 10, highCappedF % 10]).toEqual([0, 0]);
    expect([lowCappedF, highCappedF]).toEqual([30, 120]);
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
    // The frame a 24 °F move is given, at 50 °F: ten-degree ticks still.
    expect(packTempTickStep(40, 'F')).toBe(10);
    expect(packTempTickStep(39, 'F')).toBe(5);
    // The frame a 10 °F move is given.
    expect(packTempTickStep(30, 'F')).toBe(5);
  });

  it('draws the same line in Celsius, at half the numbers', () => {
    expect(packTempTickStep(25, 'C')).toBe(5);
    expect(packTempTickStep(22, 'C')).toBe(5);
    expect(packTempTickStep(21, 'C')).toBe(2.5);
    expect(packTempTickStep(20, 'C')).toBe(2.5);
  });
});

describe('packTempTicks', () => {
  it('ticks a narrow frame evenly, at the five degrees its span picks', () => {
    // The frame a 10 °F move is given: seven labels, five apart.
    expect(packTempTicks([50, 80], 'F')).toEqual([50, 55, 60, 65, 70, 75, 80]);
  });

  it('ticks a wide frame evenly, at the ten degrees its span picks', () => {
    expect(packTempTicks([40, 100], 'F')).toEqual([40, 50, 60, 70, 80, 90, 100]);
    // A capped fast charge: ten labels across the whole frame.
    expect(packTempTicks([30, 120], 'F')).toHaveLength(10);
  });

  it('carries the half degree a narrow Celsius frame is ticked at', () => {
    expect(packTempTicks([15, 35], 'C')).toEqual([15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35]);
    // Wide enough for whole fives, and no further.
    expect(packTempTicks([0, 60], 'C')).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);
  });

  it('starts and ends on the frame’s own bounds', () => {
    for (const [values, unit] of [
      [[60, 70], 'F'],
      [[40, 64], 'F'],
      [[10, 50], 'C'],
      [FLAT_C, 'C'],
    ] as const) {
      const bounds = packTempAxis(values, unit);
      const ticked = packTempTicks(bounds, unit);
      expect(ticked[0]).toBe(bounds[0]);
      expect(ticked.at(-1)).toBe(bounds[1]);
    }
  });
});
