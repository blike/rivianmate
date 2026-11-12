/**
 * The bounds of the pack temperature chart's axis, from the temperatures it
 * draws — the average, and the band's two ends — in the unit shown.
 *
 * Fitted to the readings alone, a drive that moves the pack a degree or a charge
 * that tops it up a few fills the plot with a band that reads as noise. So the
 * axis is framed rather than fitted, to a target: the readings' own span is drawn
 * at about 45 % of the plot's height — enough that a small movement is visible,
 * short of filling it.
 *
 * Two limits hold that target in. A floor of 10 °C keeps a flat session — a short
 * top-up in a cold garage moves the pack a degree — from filling the plot with
 * whatever little it did. A cap of four steps beyond the readings, 20 °C, keeps a
 * wide session from being handed an axis that draws its own movement as a flat
 * line: at the target, a real DC fast charge that moves the pack 40 °C asks for
 * 89 °C of frame, 90 to 95 once snapped outward. Capped at 60, the charge keeps
 * its shape, with a little air above and below it.
 *
 * The bounds then snap outward to whole steps — 5 °C, 10 °F — so two similar
 * sessions share an axis and can be read against each other by eye. Snapping only
 * widens, so the floor and the cap hold through it.
 *
 * The drive page and the charge page draw the pack's temperature with the one
 * chart, so this is the axis behind both.
 */
export function packTempAxis(values: readonly number[], unit: 'C' | 'F'): [number, number] {
  // The target and the limits in the unit read, so the rule holds in either: 10 °C
  // is 18 °F, and 45 % of the plot is 45 % however it is measured.
  const target = 0.45;
  const floor = unit === 'F' ? 18 : 10;
  const step = unit === 'F' ? 10 : 5;
  const known = values.filter((v) => Number.isFinite(v));
  // Nothing read: a floor's width about zero, on an axis with nothing drawn on it.
  if (known.length === 0) return [snap(-floor / 2, step, -1), snap(floor / 2, step, 1)];
  const low = Math.min(...known);
  const high = Math.max(...known);
  const middle = (low + high) / 2;
  const drawn = high - low;
  // What the target asks of the frame, held between the floor and four steps of pad.
  const span = Math.min(Math.max(drawn / target, floor), drawn + 4 * step);
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
