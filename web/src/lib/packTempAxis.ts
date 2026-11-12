/**
 * The axis the pack temperature is drawn on: where it starts and ends, and the
 * values it is ticked at — from the temperatures it draws (the average, and the
 * band's two ends), in the unit shown.
 *
 * Fitted to the readings alone, a drive that moves the pack a degree or a charge
 * that tops it up a few fills the plot with a band that reads as noise, and the
 * axis is ticked at whatever its ends imply. So the axis is framed rather than
 * fitted: ten degrees Fahrenheit — five Celsius — of air on each side of the
 * readings, which is one step in either unit, so the frame's ends land on the
 * ticks they are drawn between.
 *
 * That padding is flat, not a share of the readings' movement. The sessions this
 * chart is for move the band 10 to 25 °F: a quarter of that is two to six
 * degrees, not enough to hold a curve off the frame's edge — and a share wide
 * enough to help barely pads at all. The two rules only part company above a
 * 40 °F drawn extent, where a quarter is more than ten degrees; the cap below
 * takes over at 70, and between the two the share asks for a few degrees more on
 * a frame already seventy tall. A knob that barely fires is one rule too many,
 * so it went.
 *
 * Two limits hold the frame. A floor of 20 °F keeps a session that barely moves
 * the pack — a short top-up in a cold garage — from drawing a span of nothing. A
 * cap of 90 °F keeps a wide one — a real DC fast charge moves the pack 40 °C,
 * 72 °F — from being handed an axis so tall that its own movement reads as a
 * flat line.
 *
 * The bounds then snap outward to whole steps — 5 °C, 10 °F — so two similar
 * sessions share an axis and can be read against each other by eye. Snapping
 * only widens, so the floor holds through it, and the cap holds to within a step
 * at each end.
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
  const middle = (low + high) / 2;
  // Ten degrees of air each side, held between the floor and the cap.
  const span = Math.min(Math.max(high - low + 2 * rule.padding, rule.floor), rule.cap);
  return [snap(middle - span / 2, rule.step, -1), snap(middle + span / 2, rule.step, 1)];
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

/**
 * The numbers behind the rule, in the unit read: the width of a step between
 * bounds, the padding on each side, the floor and the cap on the frame, half the
 * width of an axis with nothing on it, the span at which ticks go from close to
 * wide, and the two tick steps.
 */
const AXIS = {
  C: { step: 5, padding: 5, floor: 11, cap: 50, empty: 5, wide: 22, wideStep: 5, closeStep: 2.5 },
  F: { step: 10, padding: 10, floor: 20, cap: 90, empty: 10, wide: 40, wideStep: 10, closeStep: 5 },
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
