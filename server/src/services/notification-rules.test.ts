import { describe, expect, it } from "vitest";
import type { NotificationEvents } from "../api-types.js";
import type { VehicleState } from "../rivian/types.js";
import { type RuleInput, type RuleState, compareVersions, emptyRuleState, evaluateRules, listLabels } from "./notification-rules.js";
import { DEFAULT_EVENTS } from "./notifications.js";

const v = (value: string | number) => ({ timeStamp: "t", value });
const state = (fields: Record<string, string | number>) =>
  Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, v(x)])) as VehicleState;

const MIN = 60_000;
const allOn: NotificationEvents = {
  ...DEFAULT_EVENTS,
  unlocked: { enabled: true, minutes: 10, awayOnly: false },
  chargingComplete: { enabled: true },
  lowBattery: { enabled: true, percent: 20 },
};

const input = (s: VehicleState, now: number, extra: Partial<RuleInput> = {}): RuleInput => ({
  state: s,
  now,
  events: allOn,
  vehicleName: "R1S",
  model: "R1S",
  atHome: false,
  pressureUnit: "psi",
  ...extra,
});

/** Runs states in order, collecting alert titles. */
function run(steps: [VehicleState, number, Partial<RuleInput>?][], start: RuleState = emptyRuleState()) {
  let rs = start;
  const titles: string[] = [];
  for (const [s, now, extra] of steps) {
    const { next, alerts } = evaluateRules(rs, input(s, now, extra));
    rs = next;
    titles.push(...alerts.map((a) => a.title));
  }
  return { titles, state: rs };
}

const closed = { doorFrontLeftClosed: "closed", doorFrontLeftLocked: "locked", windowFrontLeftClosed: "closed", powerState: "ready" };

describe("timed alerts", () => {
  it("alerts once a door has been open long enough, and not again when it closes", () => {
    const open = state({ ...closed, doorFrontLeftClosed: "open" });
    const { titles } = run([
      [state(closed), 0],
      [open, 1 * MIN],
      [open, 5 * MIN],
      [open, 6 * MIN],
      [open, 7 * MIN],
      [state(closed), 8 * MIN],
    ]);
    expect(titles).toEqual(["Driver door left open"]);
  });

  it("doesn't alert for a door closed before the time is up", () => {
    const open = state({ ...closed, doorFrontLeftClosed: "open" });
    expect(run([[open, 0], [state(closed), 4 * MIN], [open, 5 * MIN], [open, 9 * MIN]]).titles).toEqual([]);
  });

  it("holds off at home when set to away only, and while the vehicle is in use", () => {
    const awayOnly = { ...allOn, windowOpen: { enabled: true, minutes: 5, awayOnly: true } };
    const open = state({ ...closed, windowFrontLeftClosed: "open" });
    expect(run([[open, 0, { events: awayOnly, atHome: true }], [open, 10 * MIN, { events: awayOnly, atHome: true }]]).titles).toEqual([]);
    // Unknown location still alerts.
    expect(run([[open, 0, { events: awayOnly, atHome: null }], [open, 10 * MIN, { events: awayOnly, atHome: null }]]).titles).toEqual([
      "Window left open",
    ]);
    const inside = state({ ...closed, doorFrontLeftClosed: "open", powerState: "go", gearStatus: "park" });
    expect(run([[inside, 0], [inside, 10 * MIN]]).titles).toEqual([]);
  });

  it("times open windows only while parked, even with someone inside", () => {
    const window = { ...closed, windowFrontLeftClosed: "open", powerState: "go" };
    const driving = state({ ...window, gearStatus: "drive" });
    const parked = state({ ...window, gearStatus: "park" });
    // Open for the whole drive: nothing, and the clock starts at parking.
    expect(run([[driving, 0], [driving, 30 * MIN], [parked, 31 * MIN], [parked, 35 * MIN], [parked, 36 * MIN]]).titles).toEqual([
      "Window left open",
    ]);
    expect(run([[driving, 0], [parked, 30 * MIN], [parked, 34 * MIN]]).titles).toEqual([]);
  });

  it("alerts when left unlocked", () => {
    const unlocked = state({ ...closed, doorFrontLeftLocked: "unlocked" });
    // Locking re-arms the alert without a message of its own.
    expect(
      run([[unlocked, 0], [unlocked, 10 * MIN], [state(closed), 11 * MIN], [unlocked, 12 * MIN], [unlocked, 22 * MIN]]).titles,
    ).toEqual(["Vehicle unlocked", "Vehicle unlocked"]);
  });

  it("sends nothing for alerts that are off", () => {
    const off = { ...allOn, doorOpen: { enabled: false, minutes: 5, awayOnly: false } };
    const open = state({ ...closed, doorFrontLeftClosed: "open" });
    expect(run([[open, 0, { events: off }], [open, 10 * MIN, { events: off }], [state(closed), 11 * MIN, { events: off }]]).titles).toEqual([]);
  });
});

describe("tire pressure", () => {
  it("alerts on a tire the vehicle flags, then when all are normal", () => {
    const ok = { tirePressureStatusFrontLeft: "OK", tirePressureStatusFrontRight: "OK" };
    const low = state({ ...ok, tirePressureStatusFrontLeft: "LOW", tirePressureFrontLeft: 2.1 });
    const first = evaluateRules(emptyRuleState(), input(low, 0));
    expect(first.alerts[0]?.fields).toEqual([{ name: "Front left", value: "Low · 30 psi", inline: true }]);
    expect(run([[state(ok), 0], [low, 1], [low, 2], [state(ok), 3]]).titles).toEqual(["Check tire pressure", "Tire pressure normal"]);
  });
});

describe("low battery", () => {
  it("alerts below the limit and re-arms after charging up", () => {
    const at = (n: number) => state({ batteryLevel: n });
    expect(run([[at(25), 0], [at(19), 1], [at(18), 2], [at(22), 3], [at(19), 4], [at(30), 5], [at(19), 6]]).titles).toEqual([
      "Low battery",
      "Low battery",
    ]);
  });
});

describe("software updates", () => {
  const ota = (current: string, available: string, status = "Install_Success") =>
    state({ otaCurrentVersion: current, otaAvailableVersion: available, otaCurrentStatus: status });

  it("takes the first state as a baseline", () => {
    expect(run([[ota("2026.31.0", "2026.36.0"), 0]]).titles).toEqual([]);
  });

  it("announces a new update, its install, and a failure", () => {
    expect(
      run([
        [ota("2026.31.0", "0.0.0"), 0],
        [ota("2026.31.0", "2026.36.0"), 1],
        [ota("2026.31.0", "2026.36.0"), 2],
        [ota("2026.31.0", "2026.36.0", "Install_Failed"), 3],
        [ota("2026.36.0", "0.0.0"), 4],
      ]).titles,
    ).toEqual(["Software update available", "Software update failed", "Software updated"]);
  });

  it("doesn't announce a move to an older version", () => {
    expect(run([[ota("2026.36.0", "0.0.0"), 0], [ota("2026.31.0", "0.0.0"), 1]]).titles).toEqual([]);
  });

  it("links to release notes when RivianMate's address is known", () => {
    const notesUrl = (v: string) => `https://rm.example/api/vehicles/v1/ota/notes/${v}`;
    const { state: base } = run([[ota("2026.31.0", "0.0.0"), 0]]);
    const offered = evaluateRules(base, input(ota("2026.31.0", "2026.36.0"), 1, { notesUrl }));
    const url = "https://rm.example/api/vehicles/v1/ota/notes/2026.36.0";
    expect(offered.alerts[0]?.url).toBe(url);
    expect(offered.alerts[0]?.fields?.at(-1)).toEqual({ name: "Release notes", value: "View 2026.36.0 notes", url });
    const installed = evaluateRules(offered.next, input(ota("2026.36.0", "0.0.0"), 2, { notesUrl }));
    expect(installed.alerts[0]?.url).toBe(url);
    const plain = evaluateRules(base, input(ota("2026.31.0", "2026.36.0"), 1)).alerts[0];
    expect(plain?.url).toBeUndefined();
    expect(plain?.fields?.map((f) => f.name)).toEqual(["Version"]);
  });

  it("describes the update", () => {
    const { state: base } = run([[ota("2026.31.0", "0.0.0"), 0]]);
    const s = { ...ota("2026.31.0", "2026.36.0"), otaInstallType: v("Convenience"), otaInstallDuration: v(65) } as VehicleState;
    const alert = evaluateRules(base, input(s, 1)).alerts[0];
    expect(alert?.body).toBe("A new software update is ready for R1S.");
    expect(alert?.fields).toEqual([
      { name: "Version", value: "2026.36.0", inline: true },
      { name: "Type", value: "Convenience", inline: true },
      { name: "Install time", value: "About 1 hr 5 min", inline: true },
    ]);
  });
});

describe("charging complete", () => {
  it("alerts when a session finishes", () => {
    const charger = (c: string, level: number) => state({ chargerState: c, batteryLevel: level });
    const { titles } = run([
      [charger("charging_active", 70), 0],
      [charger("charging_complete", 80), 1],
      [charger("charging_complete", 80), 2],
    ]);
    expect(titles).toEqual(["Charging complete"]);
  });
});

describe("listLabels", () => {
  it("joins naturally", () => {
    expect(listLabels(["Frunk"])).toBe("Frunk");
    expect(listLabels(["Frunk", "Liftgate"])).toBe("Frunk and Liftgate");
    expect(listLabels(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("compareVersions", () => {
  it("compares numerically", () => {
    expect(compareVersions("2026.36.0", "2026.9.1")).toBe(1);
    expect(compareVersions("2026.31.0", "2026.36.0")).toBe(-1);
    expect(compareVersions("2026.36", "2026.36.0")).toBe(0);
    expect(compareVersions("abc", "2026.36.0")).toBeNull();
  });
});
