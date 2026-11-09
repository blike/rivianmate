const HOUR = 3600_000;

/** Tick spacings within a couple of months, in hours: wall-clock hours, then days. */
const STEPS_H = [1, 2, 3, 6, 12, 24, 48, 24 * 7, 24 * 14];
/** Longer spacings, in calendar months, so ticks land on the first of a month. */
const STEPS_MONTHS = [1, 2, 3, 6, 12, 24, 60, 120];

type Step = { hours: number } | { months: number };

/** A step's rough length in hours, for choosing one that gives few enough ticks. */
const approxHours = (s: Step) => ('hours' in s ? s.hours : s.months * 730);

const STEPS: Step[] = [
  ...STEPS_H.map((hours) => ({ hours })),
  ...STEPS_MONTHS.map((months) => ({ months })),
];

/**
 * Time-axis ticks on local hour, day or month boundaries, at most `maxTicks`
 * of them, with a label format to match: times of day (dates at midnight)
 * when ticks are hours apart, dates when they're days apart, and months when
 * they're months apart. A January, or every tick a year or more apart, reads
 * as its year, and past a year other months carry theirs ("Jul ’24"), so a
 * long span never repeats a label.
 */
export function timeTicks(
  min: number,
  max: number,
  maxTicks = 8,
): { ticks: number[]; format: (ts: number) => string } {
  if (!(max > min)) return { ticks: [min], format: dateLabel };
  const step =
    STEPS.find((s) => (max - min) / (approxHours(s) * HOUR) <= maxTicks) ?? STEPS.at(-1)!;

  const d = new Date(min);
  if ('months' in step) {
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    // Line multi-month steps up with the calendar: quarters from January, years on a multiple.
    const onStep = () =>
      step.months >= 12
        ? d.getMonth() === 0 && d.getFullYear() % (step.months / 12) === 0
        : d.getMonth() % step.months === 0;
    while (d.getTime() < min || !onStep()) d.setMonth(d.getMonth() + 1);
  } else if (step.hours < 24) {
    d.setMinutes(0, 0, 0);
    while (d.getTime() < min || d.getHours() % step.hours !== 0) d.setHours(d.getHours() + 1);
  } else {
    d.setHours(0, 0, 0, 0);
    if (d.getTime() < min) d.setDate(d.getDate() + 1);
  }
  const ticks: number[] = [];
  while (d.getTime() <= max) {
    ticks.push(d.getTime());
    // setHours/setDate/setMonth step by wall-clock time, so DST shifts don't drift ticks.
    if ('months' in step) d.setMonth(d.getMonth() + step.months);
    else if (step.hours < 24) d.setHours(d.getHours() + step.hours);
    else d.setDate(d.getDate() + step.hours / 24);
  }

  // Month names come round again once the ticks reach a year apart, so then they carry it.
  const first = new Date(ticks[0] ?? min);
  const last = new Date(ticks.at(-1) ?? min);
  const monthsSpanned =
    (last.getFullYear() - first.getFullYear()) * 12 + last.getMonth() - first.getMonth();
  const month = monthsSpanned >= 12 ? monthYearLabel : monthLabel;
  const format =
    'months' in step
      ? step.months >= 12
        ? yearLabel
        : (ts: number) => (new Date(ts).getMonth() === 0 ? yearLabel(ts) : month(ts))
      : step.hours < 24
        ? (ts: number) => {
            const t = new Date(ts);
            return t.getHours() === 0 && t.getMinutes() === 0 ? dateLabel(ts) : timeLabel(ts);
          }
        : dateLabel;
  return { ticks, format };
}

/** Clear space wanted between neighbouring labels, in pixels. */
const LABEL_GAP_PX = 8;

/**
 * Where a label sits along the axis, as the strip draws it: centred on its
 * tick, except near the ends, where it leans inward rather than overflow.
 */
export function labelAlign(f: number): 'start' | 'center' | 'end' {
  return f < 0.04 ? 'start' : f > 0.96 ? 'end' : 'center';
}

/**
 * `timeTicks` for an axis `widthPx` wide: the most ticks, up to `maxTicks`,
 * whose labels (measured by `measure`) don't run into each other. Without a
 * width yet it can't tell, so it gives `maxTicks`' worth.
 */
export function fitTimeTicks(
  min: number,
  max: number,
  maxTicks: number,
  widthPx: number,
  measure: (label: string) => number,
): ReturnType<typeof timeTicks> {
  let axis = timeTicks(min, max, maxTicks);
  if (!(widthPx > 0) || !(max > min)) return axis;
  for (let n = maxTicks; n >= 1; n--) {
    axis = timeTicks(min, max, n);
    if (labelsFit(axis, min, max, widthPx, measure)) return axis;
  }
  return axis;
}

function labelsFit(
  axis: ReturnType<typeof timeTicks>,
  min: number,
  max: number,
  widthPx: number,
  measure: (label: string) => number,
): boolean {
  let lastEnd = -Infinity;
  for (const t of axis.ticks) {
    const f = (t - min) / (max - min);
    const w = measure(axis.format(t));
    const x = f * widthPx;
    const align = labelAlign(f);
    const start = align === 'start' ? x : align === 'end' ? x - w : x - w / 2;
    if (start < lastEnd + LABEL_GAP_PX) return false;
    lastEnd = start + w;
  }
  return true;
}

const dateLabel = (ts: number) =>
  new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
const monthLabel = (ts: number) => new Date(ts).toLocaleDateString([], { month: 'short' });
const monthYearLabel = (ts: number) =>
  `${monthLabel(ts)} ’${String(new Date(ts).getFullYear() % 100).padStart(2, '0')}`;
const yearLabel = (ts: number) => String(new Date(ts).getFullYear());
const timeLabel = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: 'numeric' });
