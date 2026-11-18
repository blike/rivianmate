/**
 * The pack temperature axis for the values drawn, in the unit shown. Framed
 * rather than fitted, so a session that barely moves the pack doesn't fill the
 * plot: a quarter of the readings' spread as padding each side (at least 5 °F /
 * 3 °C), at least 20 °F / 11 °C tall, with bounds snapped outward to 5 °F /
 * 2.5 °C so similar sessions share an axis.
 */
export function packTempAxis(values: readonly number[], unit: 'C' | 'F'): [number, number] {
  const rule = AXIS[unit];
  const known = values.filter((v) => Number.isFinite(v));
  if (known.length === 0) return [-rule.empty, rule.empty];
  const low = Math.min(...known);
  const high = Math.max(...known);
  const drawn = high - low;
  const middle = (low + high) / 2;
  const pad = Math.max(rule.air, drawn * PAD_SHARE);
  const span = Math.max(rule.floor, drawn + 2 * pad);
  const settled: [number, number] = [
    snap(middle - span / 2, rule.step, -1),
    snap(middle + span / 2, rule.step, 1),
  ];
  // Widen to a whole number of ticks, so the first and last land on the bounds.
  const step = packTempTickStep(settled[1] - settled[0], unit);
  if (!divides(settled[1] - settled[0], step)) {
    return [snap(settled[0], step, -1), snap(settled[1], step, 1)];
  }
  return settled;
}

/** Tick spacing: 10 °F / 5 °C on a wide axis, half that on a narrow one. */
export function packTempTickStep(span: number, unit: 'C' | 'F'): number {
  const rule = AXIS[unit];
  return span >= rule.wide ? rule.wideStep : rule.closeStep;
}

/** The tick values from the bottom bound to the top. */
export function packTempTicks([low, high]: readonly [number, number], unit: 'C' | 'F'): number[] {
  const step = packTempTickStep(high - low, unit);
  const count = Math.floor((high - low) / step + 1e-9);
  // Rounded, since sums of 2.5 pick up float noise.
  return Array.from({ length: count + 1 }, (_, i) => Number((low + i * step).toFixed(2)));
}

const PAD_SHARE = 0.25;

const AXIS = {
  C: { step: 2.5, air: 3, floor: 11, empty: 5, wide: 22, wideStep: 5, closeStep: 2.5 },
  F: { step: 5, air: 5, floor: 20, empty: 10, wide: 40, wideStep: 10, closeStep: 5 },
} as const;

/** Rounds a bound outward to a whole step, with slack for float error. */
function snap(value: number, step: number, direction: -1 | 1): number {
  const steps = direction < 0 ? Math.floor(value / step + 1e-9) : Math.ceil(value / step - 1e-9);
  const snapped = steps * step;
  return snapped === 0 ? 0 : snapped; // not -0
}

function divides(span: number, step: number): boolean {
  return Math.abs(Math.round(span / step) * step - span) < 1e-9;
}
