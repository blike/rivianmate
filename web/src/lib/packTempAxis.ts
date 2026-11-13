/**
 * The axis the pack temperature is drawn on: where it starts and ends, and the
 * values it is ticked at — from the temperatures it draws (the average, and the
 * band's two ends), in the unit shown.
 *
 * Fitted to the readings alone, a drive that moves the pack a degree or a charge
 * that tops it up a few fills the plot with a band that reads as noise. So the
 * axis is framed rather than fitted: a quarter of the drawn extent of air on
 * each side of the readings — proportional, so a band that moves a lot is given
 * room in proportion — and never less than five degrees Fahrenheit, three
 * Celsius, a side, so the frame's ends hold a curve off its own edge.
 *
 * A floor of 20 °F / 11 °C holds the bottom of the range. The measured 31 Oct
 * drive draws 9 °F, which asks for a 19 °F frame and is given 20; the band then
 * fills a third of the plot rather than all of it. Below that the frame is the
 * floor, never nothing.
 *
 * There is no cap. Proportional padding is what keeps a wide session from
 * looking absurd, and a cap would clamp the width while the bounds stayed
 * centred on the readings — so a big enough swing would have its own ends cut
 * off. The widest session this chart is for, a 40 °C DC fast charge, draws 72 °F
 * and asks for 108, and is given 110 once the bounds snap: room to move in, and
 * every reading a step or more inside it.
 *
 * The bounds then snap outward to the fine grid — 5 °F, 2.5 °C — so two similar
 * sessions share an axis and can be read against each other by eye. Snapping
 * only widens, so the floor holds through it. The grid is deliberately fine: on
 * a 10 °F one the 31 Oct drive's 29 °F frame snapped out to 50…90, which is the
 * width complaint this rule answers.
 *
 * The ticks then take one of two fixed intervals — 10 °F, 5 °C where the frame
 * is 40 °F / 22 °C or wider, 5 °F / 2.5 °C below that. Two fixed choices and
 * never the chart's own spacing, which lands on whatever the frame's ends imply
 * and reads as labels like 60, 68, 76, 90. A frame the interval doesn't divide
 * is widened to the next one, outward, so the first and last tick sit on the
 * bounds and every reading stays inside.
 *
 * The drive page and the charge page draw the pack's temperature with the one
 * chart, so this is the axis behind both.
 */
export function packTempAxis(values: readonly number[], unit: 'C' | 'F'): [number, number] {
  const rule = AXIS[unit];
  const known = values.filter((v) => Number.isFinite(v));
  // Nothing read: a frame either side of zero, on an axis with nothing drawn on it.
  if (known.length === 0) return [-rule.empty, rule.empty];
  const low = Math.min(...known);
  const high = Math.max(...known);
  const drawn = high - low;
  const middle = (low + high) / 2;
  // A quarter of the movement each side, and never less than the least air a
  // side is given — five degrees Fahrenheit, three Celsius.
  const pad = Math.max(rule.air, drawn * PAD_SHARE);
  const span = Math.max(rule.floor, drawn + 2 * pad);
  const settled: [number, number] = [
    snap(middle - span / 2, rule.step, -1),
    snap(middle + span / 2, rule.step, 1),
  ];
  // Ticks have to start and end on the frame's bounds, so a frame the interval
  // doesn't divide widens to the next one — outward, so nothing moves inside it.
  const step = packTempTickStep(settled[1] - settled[0], unit);
  if (!divides(settled[1] - settled[0], step)) {
    return [snap(settled[0], step, -1), snap(settled[1], step, 1)];
  }
  return settled;
}

/**
 * The step between the axis's ticks, in the unit read: ten degrees Fahrenheit
 * where the frame is wide enough to carry them, five where it is not, and the
 * same choice in Celsius at half the numbers. Two steps, picked by the span —
 * never the chart's own, which lands on whatever the frame's ends imply and
 * reads as labels like 60, 68, 76, 90 of a frame that should read 60, 70, 80,
 * 90.
 */
export function packTempTickStep(span: number, unit: 'C' | 'F'): number {
  const rule = AXIS[unit];
  return span >= rule.wide ? rule.wideStep : rule.closeStep;
}

/**
 * The values the framed axis is ticked at: evenly spaced at the step the span
 * picks, from the bottom bound to the top, both of which landed on a step when
 * the frame was snapped outward.
 */
export function packTempTicks([low, high]: readonly [number, number], unit: 'C' | 'F'): number[] {
  const step = packTempTickStep(high - low, unit);
  const count = Math.floor((high - low) / step + 1e-9);
  // Counted off the bottom bound rather than accumulated, and rounded off the
  // arithmetic's float noise — 2.5 °C steps are exact, a sum of them need not be.
  return Array.from({ length: count + 1 }, (_, i) => Number((low + i * step).toFixed(2)));
}

/** The share of the drawn extent given as air on each side of the readings. */
const PAD_SHARE = 0.25;

/**
 * The numbers behind the rule, in the unit read: the fine grid a bound snaps to,
 * the least air a side is given, the floor under the frame, half the width of an
 * axis with nothing on it, the span at which ticks go from close to wide, and
 * the two tick steps.
 */
const AXIS = {
  C: { step: 2.5, air: 3, floor: 11, empty: 5, wide: 22, wideStep: 5, closeStep: 2.5 },
  F: { step: 5, air: 5, floor: 20, empty: 10, wide: 40, wideStep: 10, closeStep: 5 },
} as const;

/**
 * A bound rounded outward to a whole step: down for the bottom of an axis, up for
 * the top. A hair of slack keeps a bound that lands on a step — give or take the
 * arithmetic — on that step rather than the one beyond it.
 */
function snap(value: number, step: number, direction: -1 | 1): number {
  const steps = direction < 0 ? Math.floor(value / step + 1e-9) : Math.ceil(value / step - 1e-9);
  const snapped = steps * step;
  // A bound that rounds to zero is zero, not a negative nothing.
  return snapped === 0 ? 0 : snapped;
}

/** Whether a frame's width is a whole number of tick intervals. */
function divides(span: number, step: number): boolean {
  return Math.abs(Math.round(span / step) * step - span) < 1e-9;
}
