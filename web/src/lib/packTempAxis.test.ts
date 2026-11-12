import { describe, expect, it } from 'vitest';
import { packTempAxis } from './packTempAxis';

/**
 * The pack temperatures a chart drew, in the unit read: the average, and the
 * band's two ends. `flat` is a short top-up in a cold garage; `wide` is a long
 * charge that moves the pack 30 degrees.
 */
const FLAT_C = [20.6, 26.7, 21.6, 23.1, 24.6];
const WIDE_C = [10, 40];
const FLAT_F = [69.1, 80.1, 73.6];
/** The same 3 °C session as °C and as °F. */
const THREE_C = [21, 22, 23, 24];
const THREE_F = [69.8, 71.6, 73.4, 75.2];

describe('packTempAxis', () => {
  it('frames a session that barely moves the pack, so it does not fill the plot', () => {
    const [low, high] = packTempAxis(THREE_C, 'C');

    expect([low, high]).toEqual([15, 30]);
    // Three degrees in a frame of ten at least, so it draws at a third or less.
    expect(high - low).toBeGreaterThanOrEqual(10);
    expect((25.1 - 22.1) / (high - low)).toBeLessThanOrEqual(1 / 3);
    expect(low).toBeLessThanOrEqual(THREE_C[0]!);
    expect(high).toBeGreaterThanOrEqual(THREE_C.at(-1)!);
  });

  it('keeps a session that moves the pack far inside its frame, rather than clipping it', () => {
    const [low, high] = packTempAxis(WIDE_C, 'C');

    expect(low).toBeLessThanOrEqual(10);
    expect(high).toBeGreaterThanOrEqual(40);
    expect(high - low).toBeGreaterThanOrEqual((40 - 10) / 0.3);
  });

  it('centres the frame on the readings it holds', () => {
    const [low, high] = packTempAxis(FLAT_C, 'C');

    // The readings run 20.6 to 26.7; the frame is the nearest whole steps out.
    expect([low, high]).toEqual([10, 35]);
    expect((low + high) / 2).toBeGreaterThanOrEqual(20.6);
    expect((low + high) / 2).toBeLessThanOrEqual(26.7);
  });

  it('snaps the bounds outward to whole steps, in the unit read', () => {
    const [lowC, highC] = packTempAxis(FLAT_C, 'C');
    expect(lowC % 5).toBe(0);
    expect(highC % 5).toBe(0);

    const [lowF, highF] = packTempAxis(FLAT_F, 'F');
    expect(lowF % 10).toBe(0);
    expect(highF % 10).toBe(0);
    expect(lowF).toBeLessThanOrEqual(69.1);
    expect(highF).toBeGreaterThanOrEqual(80.1);
  });

  it('reads the floor in the unit shown, so a third of the plot is a third in either', () => {
    const [lowC, highC] = packTempAxis(THREE_C, 'C');
    const [lowF, highF] = packTempAxis(THREE_F, 'F');

    // 10 °C is 18 °F: the same session, framed the same way.
    expect(highC - lowC).toBeGreaterThanOrEqual(10);
    expect(highF - lowF).toBeGreaterThanOrEqual(18);
    expect(5.4 / (highF - lowF)).toBeLessThanOrEqual(1 / 3);
  });

  it('has nothing to frame without readings', () => {
    expect(packTempAxis([], 'C')).toEqual([-5, 5]);
    expect(packTempAxis([], 'F')).toEqual([-10, 10]);
  });
});
