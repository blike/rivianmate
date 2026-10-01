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
