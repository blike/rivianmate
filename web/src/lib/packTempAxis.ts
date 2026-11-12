/**
 * The bounds of the pack temperature chart's axis, from the temperatures it
 * draws — the average, and the band's two ends — in the unit shown.
 *
 * Fitted to the readings alone, a drive that moves the pack a degree or a charge
 * that tops it up a few fills the plot with a band that reads as noise. So the
 * axis is framed rather than fitted: it spans at least 10 °C, and at least the
 * readings' own span divided by 0.3, centred on them, so they fill no more than
 * a third of the height. A three-degree session then draws in a third of the
 * plot instead of all of it.
 *
 * The bounds then snap outward to whole steps — 5 °C, 10 °F — so two similar
 * sessions share an axis and can be read against each other by eye. Snapping only
 * widens, so the floor below is never lost to it.
 *
 * The drive page and the charge page draw the pack's temperature with the one
 * chart, so this is the axis behind both.
 */
export function packTempAxis(values: readonly number[], unit: 'C' | 'F'): [number, number] {
  // The floor and the step in the unit read, so the rule holds in either: 10 °C
  // is 18 °F, and a third of the plot is a third however it is measured.
  const floor = unit === 'F' ? 18 : 10;
  const step = unit === 'F' ? 10 : 5;
  const known = values.filter((v) => Number.isFinite(v));
  // Nothing read: a floor's width about zero, on an axis with nothing drawn on it.
  if (known.length === 0) return [snap(-floor / 2, step, -1), snap(floor / 2, step, 1)];
  const low = Math.min(...known);
  const high = Math.max(...known);
  const middle = (low + high) / 2;
  const span = Math.max(floor, (high - low) / 0.3);
  return [snap(middle - span / 2, step, -1), snap(middle + span / 2, step, 1)];
}

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
