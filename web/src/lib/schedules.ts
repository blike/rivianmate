const ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const SHORT: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
};

/** Minutes after midnight → "11:00 PM" (in the viewer's locale). */
export function formatTimeOfDay(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const d = new Date(2000, 0, 1, Math.floor(minutes / 60) % 24, Math.round(minutes % 60));
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Rivian seat levels: "Heat2" → "Heat 2", "Off" → "Off". */
export function formatSeatLevel(level: string | number | null | undefined): string {
  if (level == null || level === "") return "—";
  return String(level).replace(/([a-z])(\d)/gi, "$1 $2");
}

/** ["Monday", …] → "Weekdays", "Every day", or "Mon, Wed, Fri". */
export function formatWeekDays(days: string[] | null | undefined): string {
  if (!days?.length) return "—";
  const norm = [...new Set(days.map((d) => d.trim().toLowerCase()))]
    .filter((d) => ORDER.includes(d))
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  if (norm.length === 7) return "Every day";
  if (norm.length === 5 && norm.every((d) => ORDER.slice(0, 5).includes(d))) return "Weekdays";
  if (norm.length === 2 && norm.includes("saturday") && norm.includes("sunday")) return "Weekends";
  return norm.length ? norm.map((d) => SHORT[d]).join(", ") : days.join(", ");
}

const DAY = 24 * 60;

/** The parts of a charging schedule the timeline needs. */
export interface ScheduleWindow {
  startTime: number | null;
  duration: number | null;
  weekDays: string[] | null;
}

function dayIndexes(days: string[] | null): number[] {
  return (days ?? []).map((d) => ORDER.indexOf(d.trim().toLowerCase())).filter((i) => i >= 0);
}

/**
 * Each weekday's charging spans, Monday first, as [start, end) minutes
 * after midnight. A window running past midnight continues on the next day.
 */
export function weekSpans(schedules: readonly ScheduleWindow[]): [number, number][][] {
  const week: [number, number][][] = ORDER.map(() => []);
  for (const s of schedules) {
    if (s.startTime == null || !s.duration || s.duration <= 0) continue;
    const length = Math.min(s.duration, 7 * DAY);
    for (const day of dayIndexes(s.weekDays)) {
      let start = s.startTime;
      let left = length;
      for (let d = day; left > 0; d = (d + 1) % 7) {
        const end = Math.min(DAY, start + left);
        week[d]!.push([start, end]);
        left -= end - start;
        start = 0;
      }
    }
  }
  return week;
}

export type ScheduleStatus =
  | { open: true; endsAt: Date }
  | { open: false; startsAt: Date }
  | null;

/** Whether a charging window is open now and when it ends, or when the next one starts. */
export function scheduleStatus(schedules: readonly ScheduleWindow[], now: Date): ScheduleStatus {
  const windows: { start: Date; end: Date }[] = [];
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const s of schedules) {
    if (s.startTime == null || !s.duration || s.duration <= 0) continue;
    const days = dayIndexes(s.weekDays);
    // A week back covers windows still running; eight days ahead covers the next start.
    for (let offset = -7; offset <= 8; offset++) {
      const date = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() + offset);
      if (!days.includes((date.getDay() + 6) % 7)) continue;
      const start = new Date(date.getTime());
      start.setMinutes(s.startTime);
      windows.push({ start, end: new Date(start.getTime() + s.duration * 60_000) });
    }
  }
  const t = now.getTime();
  const open = windows.filter((w) => w.start.getTime() <= t && t < w.end.getTime());
  if (open.length > 0) {
    return { open: true, endsAt: new Date(Math.max(...open.map((w) => w.end.getTime()))) };
  }
  const next = windows.filter((w) => w.start.getTime() > t).sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  return next ? { open: false, startsAt: next.start } : null;
}

/** "12:00 AM – 6:00 AM". */
export function formatTimeRange(startMinutes: number | null, durationMinutes: number | null): string {
  if (startMinutes == null || durationMinutes == null) return "—";
  return `${formatTimeOfDay(startMinutes)} – ${formatTimeOfDay((startMinutes + durationMinutes) % DAY)}`;
}

/** "today", "tonight" (early tomorrow), "tomorrow", or a weekday name. */
export function dayLabel(date: Date, now: Date): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(date) - day(now)) / (DAY * 60_000));
  if (diff === 0) return "today";
  if (diff === 1) return date.getHours() < 4 ? "tonight" : "tomorrow";
  return date.toLocaleDateString([], { weekday: "long" });
}

/** Approximate charging power for a current, assuming a 240 V supply. */
export const kwAt240V = (amps: number) => (amps * 240) / 1000;
