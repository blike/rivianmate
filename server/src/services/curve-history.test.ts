import { describe, expect, it } from "vitest";
import { assignCurvePoints } from "./curve-history.js";

const t = (iso: string) => new Date(iso);
const NOW = Date.parse("2026-10-01T12:00:00Z");

describe("assignCurvePoints", () => {
  const sessions = [
    { id: 1, startedAt: t("2026-10-01T08:00:00Z"), endedAt: t("2026-10-01T09:00:00Z") },
    { id: 2, startedAt: t("2026-10-01T11:00:00Z"), endedAt: null },
  ];

  it("puts points into the session that contains them", () => {
    const r = assignCurvePoints(
      [
        { ts: t("2026-10-01T08:30:00Z"), powerKw: 11 },
        { ts: t("2026-10-01T09:01:00Z"), powerKw: 2 }, // within end slack
        { ts: t("2026-10-01T11:30:00Z"), powerKw: 9 }, // open session runs to now
      ],
      sessions,
      NOW,
    );
    expect(r.get(1)?.map((p) => p.powerKw)).toEqual([11, 2]);
    expect(r.get(2)?.map((p) => p.powerKw)).toEqual([9]);
  });

  it("drops points outside every session", () => {
    const r = assignCurvePoints([{ ts: t("2026-10-01T10:00:00Z"), powerKw: 5 }], sessions, NOW);
    expect(r.size).toBe(0);
  });
});
