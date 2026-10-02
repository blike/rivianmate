const HOUR = 3600_000;

/** Tick spacings to choose from, in hours. */
const STEPS_H = [1, 2, 3, 6, 12, 24, 48, 24 * 7, 24 * 14, 24 * 30];

/**
 * Time-axis ticks on local hour or day boundaries, at most `maxTicks` of
 * them, with a label format to match: times of day (dates at midnight) when
 * ticks are hours apart, dates when they're days apart.
 */
export function timeTicks(
  min: number,
  max: number,
  maxTicks = 8,
): { ticks: number[]; format: (ts: number) => string } {
  if (!(max > min)) return { ticks: [min], format: dateLabel };
  const stepH = STEPS_H.find((h) => (max - min) / (h * HOUR) <= maxTicks) ?? STEPS_H.at(-1)!;

  const d = new Date(min);
  if (stepH < 24) {
    d.setMinutes(0, 0, 0);
    while (d.getTime() < min || d.getHours() % stepH !== 0) d.setHours(d.getHours() + 1);
  } else {
    d.setHours(0, 0, 0, 0);
    if (d.getTime() < min) d.setDate(d.getDate() + 1);
  }
  const ticks: number[] = [];
  while (d.getTime() <= max) {
    ticks.push(d.getTime());
    // setHours/setDate step by wall-clock time, so DST shifts don't drift ticks.
    if (stepH < 24) d.setHours(d.getHours() + stepH);
    else d.setDate(d.getDate() + stepH / 24);
  }

  const format =
    stepH < 24
      ? (ts: number) => {
          const t = new Date(ts);
          return t.getHours() === 0 && t.getMinutes() === 0 ? dateLabel(ts) : timeLabel(ts);
        }
      : dateLabel;
  return { ticks, format };
}

const dateLabel = (ts: number) => new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
const timeLabel = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "numeric" });
