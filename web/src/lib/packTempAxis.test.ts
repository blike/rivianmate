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
/** A 6 °C session, centred on a step so its frame is the target's width. */
const SIX_C = [19.5, 22.5, 25.5];
/** A session that moves the pack a degree. */
const ONE_C = [24.5, 25.5];
/** A real DC fast charge: the pack moves 40 °C. */
const DC_C = [10, 50];

describe('packTempAxis', () => {
  it('frames a session that barely moves the pack, so it does not fill the plot', () => {
    const [low, high] = packTempAxis(THREE_C, 'C');

    expect([low, high]).toEqual([15, 30]);
    // Three degrees in a frame of ten at least, so it draws well under the target.
    expect(high - low).toBeGreaterThanOrEqual(10);
    expect((THREE_C.at(-1)! - THREE_C[0]!) / (high - low)).toBeLessThanOrEqual(0.45);
    expect(low).toBeLessThanOrEqual(THREE_C[0]!);
    expect(high).toBeGreaterThanOrEqual(THREE_C.at(-1)!);
  });

  it('draws a six-degree span at about 45 % of the plot, in 15 °C rather than 25', () => {
    const [low, high] = packTempAxis(SIX_C, 'C');

    // 6 °C / 0.45 = 13.3 °C of frame, centred on 22.5 and snapped out to whole steps.
    expect([low, high]).toEqual([15, 30]);
    expect(6 / (high - low)).toBeCloseTo(0.4, 2);
    // The rule this replaced asked for 6 / 0.3 = 20 °C, which snapped out to 25.
    expect(high - low).toBeLessThan(25);
  });

  it('keeps a session that moves the pack far inside its frame, rather than clipping it', () => {
    const [low, high] = packTempAxis(WIDE_C, 'C');

    expect([low, high]).toEqual([0, 50]);
    expect(low).toBeLessThanOrEqual(10);
    expect(high).toBeGreaterThanOrEqual(40);
    // Thirty degrees held at the target would be 67; the cap of four steps cuts it to 50.
    expect(high - low).toBeLessThan(30 / 0.45);
  });

  it('caps a wide session, so a 40 °C charge is not given a hundred-degree axis', () => {
    const [low, high] = packTempAxis(DC_C, 'C');

    // Four steps of padding beyond the readings: 40 + 20 = 60, and it snaps out to 60.
    expect([low, high]).toEqual([0, 60]);
    expect(high - low).toBeLessThan(DC_C[1]! - DC_C[0]! + 4 * 5 + 5);
    // The rule this replaced framed the same charge at 40 / 0.3 = 133 °C, snapped to 140.
    expect(high - low).toBeLessThan(40 / 0.3);
    // The readings still sit inside it, uncut.
    expect(low).toBeLessThanOrEqual(10);
    expect(high).toBeGreaterThanOrEqual(50);
  });

  it('holds a one-degree session at the floor, so it does not draw as a full plot', () => {
    const [low, high] = packTempAxis(ONE_C, 'C');

    // One degree in a frame of ten is 10 % of the plot, not all of it.
    expect([low, high]).toEqual([20, 30]);
    expect(high - low).toBe(10);
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
    expect(lowC % 5).toBe(0);
    expect(highC % 5).toBe(0);

    const [lowF, highF] = packTempAxis(FLAT_F, 'F');
    expect(lowF % 10).toBe(0);
    expect(highF % 10).toBe(0);
    expect(lowF).toBeLessThanOrEqual(69.1);
    expect(highF).toBeGreaterThanOrEqual(80.1);

    // The capped case too: 72 °F of movement, four steps of pad at 10 °F.
    const [lowWideF, highWideF] = packTempAxis([50, 122], 'F');
    expect([lowWideF % 10, highWideF % 10]).toEqual([0, 0]);
    expect([lowWideF, highWideF]).toEqual([30, 150]);
  });

  it('reads the floor and the cap in the unit shown, so a share of the plot is that share in either', () => {
    const [lowC, highC] = packTempAxis(THREE_C, 'C');
    const [lowF, highF] = packTempAxis(THREE_F, 'F');

    // 10 °C is 18 °F: the same session, framed the same way.
    expect(highC - lowC).toBeGreaterThanOrEqual(10);
    expect(highF - lowF).toBeGreaterThanOrEqual(18);
    expect(5.4 / (highF - lowF)).toBeLessThanOrEqual(0.45);
  });

  it('has nothing to frame without readings', () => {
    expect(packTempAxis([], 'C')).toEqual([-5, 5]);
    expect(packTempAxis([], 'F')).toEqual([-10, 10]);
  });
});
