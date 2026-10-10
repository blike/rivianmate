import type { NotificationEvents, TimedAlertSettings } from "../api-types.js";
import { closureStatuses } from "../closures.js";
import type { VehicleState } from "../rivian/types.js";
import type { Alert, AlertField } from "./notify-channels.js";
import { stateNumber, stateString } from "./state-utils.js";

const MINUTE_MS = 60_000;
/** Low-battery alerts re-arm only once the level is this far above the limit. */
const LOW_BATTERY_RESET_POINTS = 5;
const NO_VERSION = new Set(["", "0.0.0"]);
const BAR_TO_PSI = 14.5038;

type TimedKind = "doorOpen" | "windowOpen" | "unlocked";

interface TimedState {
  /** When each item was first seen in the alerting condition (ms). */
  since: Record<string, number>;
  /** Labels already alerted on, so each is announced once. */
  alerted: string[];
}

/** What's been seen and announced per vehicle; persisted across restarts. */
export interface RuleState {
  timed: Record<TimedKind, TimedState>;
  tiresAlerted: string[];
  lowBatteryAlerted: boolean;
  lastAvailable: string | null;
  lastCurrent: string | null;
  lastCurrentStatus: string | null;
  lastChargerState: string | null;
  /** False until the first state is seen; transitions need a baseline. */
  initialized: boolean;
}

export function emptyRuleState(): RuleState {
  const timed = (): TimedState => ({ since: {}, alerted: [] });
  return {
    timed: { doorOpen: timed(), windowOpen: timed(), unlocked: timed() },
    tiresAlerted: [],
    lowBatteryAlerted: false,
    lastAvailable: null,
    lastCurrent: null,
    lastCurrentStatus: null,
    lastChargerState: null,
    initialized: false,
  };
}

export interface RuleInput {
  state: VehicleState;
  now: number;
  events: NotificationEvents;
  /** Display name, e.g. "R1S". */
  vehicleName: string;
  model: string | null;
  /** null when no home location is known or there's no GPS fix. */
  atHome: boolean | null;
  pressureUnit: "psi" | "bar";
  /** Link to a version's release notes in RivianMate; null without an app address. */
  notesUrl?: (version: string) => string | null;
}

const TIRES = [
  { label: "Front left", status: "tirePressureStatusFrontLeft", pressure: "tirePressureFrontLeft" },
  { label: "Front right", status: "tirePressureStatusFrontRight", pressure: "tirePressureFrontRight" },
  { label: "Rear left", status: "tirePressureStatusRearLeft", pressure: "tirePressureRearLeft" },
  { label: "Rear right", status: "tirePressureStatusRearRight", pressure: "tirePressureRearRight" },
];

/**
 * Compares dotted versions numerically ("2026.36.0" > "2026.9.1"); null if
 * either isn't one.
 */
export function compareVersions(a: string, b: string): number | null {
  const parse = (v: string) => (/^\d+(\.\d+)*$/.test(v) ? v.split(".").map(Number) : null);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** "a", "a and b", "a, b and c". */
export function listLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

const minutesLabel = (m: number) => (m === 1 ? "1 minute" : `${m} minutes`);

/** Present-but-empty fields count as "no value"; absent ones as "unknown". */
function has(state: VehicleState, key: string): boolean {
  return state[key] !== undefined;
}

/**
 * Works out which alerts to send for a new vehicle state. Tracking always
 * runs, so turning an alert on later doesn't replay old changes; only the
 * sending depends on the settings.
 */
export function evaluateRules(prev: RuleState, input: RuleInput): { next: RuleState; alerts: Alert[] } {
  const { state, now, events, vehicleName: name } = input;
  const next: RuleState = structuredClone(prev);
  const alerts: Alert[] = [];
  const baseline = prev.initialized;

  // --- Closures and locks, alerted after they've lasted a while ---
  const { closures, windows } = closureStatuses(state, input.model);
  const power = stateString(state, "powerState");
  const gear = stateString(state, "gearStatus");
  const speed = stateNumber(state, "gnssSpeed") ?? 0; // m/s
  const driving = gear === "drive" || gear === "reverse" || (power === "go" && speed > 1);
  // Someone's in the vehicle: open doors and unlocked are expected.
  const inUse = power === "go";
  const unlocked = closures.some((c) => c.locked === false);

  const timed = (
    kind: TimedKind,
    open: string[],
    cfg: TimedAlertSettings,
    describe: TimedCopy,
    /** Hold the alert while someone's in the parked vehicle. */
    waitWhileInUse: boolean,
  ) => {
    const cur = next.timed[kind];
    if (open.length === 0) {
      next.timed[kind] = { since: {}, alerted: [] };
      return;
    }
    // Time only counts while parked: the clock starts when the vehicle parks.
    cur.since = driving ? {} : Object.fromEntries(open.map((label) => [label, cur.since[label] ?? now]));
    cur.alerted = cur.alerted.filter((label) => open.includes(label));
    if (!cfg.enabled || driving || (waitWhileInUse && inUse) || (cfg.awayOnly && input.atHome === true)) return;
    const due = open.filter((label) => !cur.alerted.includes(label) && now - cur.since[label]! >= cfg.minutes * MINUTE_MS);
    if (due.length === 0) return;
    cur.alerted.push(...due);
    alerts.push(describe.alert(name, due, cfg.minutes));
  };

  timed("doorOpen", closures.filter((c) => !c.closed).map((c) => c.label), events.doorOpen, DOOR_COPY, true);
  // Open windows matter whenever the vehicle is parked, even with someone in it.
  timed("windowOpen", windows.filter((w) => !w.closed).map((w) => w.label), events.windowOpen, WINDOW_COPY, false);
  timed("unlocked", unlocked ? ["Vehicle"] : [], events.unlocked, LOCK_COPY, true);

  // --- Tire pressure, as judged by the vehicle ---
  const lowTires = TIRES.filter((t) => {
    const status = stateString(state, t.status);
    return status != null && status.toUpperCase() !== "OK";
  });
  const reported = TIRES.some((t) => has(state, t.status));
  if (reported) {
    const labels = lowTires.map((t) => t.label);
    const fresh = lowTires.filter((t) => !next.tiresAlerted.includes(t.label));
    if (fresh.length > 0 && events.tirePressure.enabled) {
      const fields = lowTires.map((t): AlertField => {
        const bar = stateNumber(state, t.pressure);
        const status = sentenceCase(stateString(state, t.status)!);
        return { name: t.label, value: bar != null ? `${status} · ${formatPressure(bar, input.pressureUnit)}` : status, inline: true };
      });
      alerts.push({ title: "Check tire pressure", body: `${name} reports a tire pressure problem.`, level: "warning", fields });
      next.tiresAlerted = labels;
    } else if (labels.length === 0 && next.tiresAlerted.length > 0) {
      if (events.tirePressure.enabled) {
        alerts.push({ title: "Tire pressure normal", body: `All tire pressures on ${name} are back to normal.`, level: "success" });
      }
      next.tiresAlerted = [];
    } else {
      next.tiresAlerted = next.tiresAlerted.filter((l) => labels.includes(l));
    }
  }

  // --- Low battery, re-armed once it's charged back up ---
  const battery = stateNumber(state, "batteryLevel");
  if (battery != null) {
    const limit = events.lowBattery.percent;
    if (!next.lowBatteryAlerted && battery < limit && events.lowBattery.enabled) {
      alerts.push({
        title: "Low battery",
        body: `${name} is running low.`,
        level: "warning",
        fields: [
          { name: "Battery", value: `${Math.round(battery)}%`, inline: true },
          { name: "Alert below", value: `${limit}%`, inline: true },
        ],
      });
      next.lowBatteryAlerted = true;
    } else if (next.lowBatteryAlerted && battery >= limit + LOW_BATTERY_RESET_POINTS) {
      next.lowBatteryAlerted = false;
    }
  }

  // --- Software updates ---
  if (has(state, "otaCurrentVersion")) {
    const current = stateString(state, "otaCurrentVersion")?.trim() ?? "";
    if (!NO_VERSION.has(current)) {
      // Only a move to a newer version is an update; a rollback or a
      // glitchy reading isn't announced.
      const newer = prev.lastCurrent ? compareVersions(current, prev.lastCurrent) : null;
      if (baseline && prev.lastCurrent && (newer ?? (current !== prev.lastCurrent ? 1 : 0)) > 0 && events.updateInstalled.enabled) {
        alerts.push({
          title: "Software updated",
          body: `${name} finished installing a software update.`,
          level: "success",
          ...withNotes(input, current, [
            { name: "Version", value: current, inline: true },
            { name: "Previous", value: prev.lastCurrent, inline: true },
          ]),
        });
      }
      next.lastCurrent = current;
    }
  }
  if (has(state, "otaAvailableVersion")) {
    const raw = stateString(state, "otaAvailableVersion")?.trim() ?? "";
    const available = !NO_VERSION.has(raw) && raw !== next.lastCurrent ? raw : null;
    if (baseline && available && available !== prev.lastAvailable && events.updateAvailable.enabled) {
      const minutes = stateNumber(state, "otaInstallDuration");
      const type = stateString(state, "otaInstallType");
      const fields: AlertField[] = [{ name: "Version", value: available, inline: true }];
      if (type) fields.push({ name: "Type", value: sentenceCase(type), inline: true });
      if (minutes != null && minutes > 0) fields.push({ name: "Install time", value: durationLabel(minutes), inline: true });
      alerts.push({
        title: "Software update available",
        body: `A new software update is ready for ${name}.`,
        level: "info",
        ...withNotes(input, available, fields),
      });
    }
    next.lastAvailable = available;
  }
  if (has(state, "otaCurrentStatus")) {
    const status = stateString(state, "otaCurrentStatus");
    const failed = /fail|error/i.test(status ?? "");
    const wasFailed = /fail|error/i.test(prev.lastCurrentStatus ?? "");
    if (baseline && failed && !wasFailed && events.updateFailed.enabled) {
      alerts.push({
        title: "Software update failed",
        body: `An update didn't install on ${name}. Check the vehicle or the Rivian app for details.`,
        level: "failure",
        ...(next.lastAvailable ? { fields: [{ name: "Version", value: next.lastAvailable, inline: true }] } : {}),
      });
    }
    next.lastCurrentStatus = status;
  }

  // --- Charging ---
  if (has(state, "chargerState")) {
    const charger = stateString(state, "chargerState");
    if (
      baseline &&
      charger === "charging_complete" &&
      prev.lastChargerState != null &&
      prev.lastChargerState !== "charging_complete" &&
      events.chargingComplete.enabled
    ) {
      alerts.push({
        title: "Charging complete",
        body: `${name} finished charging.`,
        level: "success",
        ...(battery != null ? { fields: [{ name: "Battery", value: `${Math.round(battery)}%`, inline: true }] } : {}),
      });
    }
    next.lastChargerState = charger;
  }

  next.initialized = true;
  return { next, alerts };
}

/** Facts plus, when RivianMate's address is known, a release-notes link. */
function withNotes(input: RuleInput, version: string, fields: AlertField[]): Pick<Alert, "url" | "fields"> {
  const url = input.notesUrl?.(version);
  if (!url) return { fields };
  return { url, fields: [...fields, { name: "Release notes", value: `View ${version} notes`, url }] };
}

/** "CONVENIENCE" or "low_pressure" → "Convenience", "Low pressure". */
function sentenceCase(value: string): string {
  const words = value.replaceAll("_", " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** 65 → "About 1 hr 5 min". */
function durationLabel(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `About ${m} min`;
  return `About ${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ""}`;
}

function formatPressure(bar: number, unit: "psi" | "bar"): string {
  return unit === "psi" ? `${Math.round(bar * BAR_TO_PSI)} psi` : `${bar.toFixed(2)} bar`;
}

interface TimedCopy {
  alert: (name: string, labels: string[], minutes: number) => Alert;
}

const DOOR_COPY: TimedCopy = {
  alert: (name, labels, minutes) => ({
    title: labels.length === 1 ? `${labels[0]} left open` : "Doors left open",
    body: `${listLabels(labels)} on ${name} ${labels.length === 1 ? "has" : "have"} been open for ${minutesLabel(minutes)}.`,
    level: "warning",
  }),
};

const WINDOW_COPY: TimedCopy = {
  alert: (name, labels, minutes) => ({
    title: labels.length === 1 ? "Window left open" : "Windows left open",
    body: `${listLabels(labels)} on ${name} ${labels.length === 1 ? "has" : "have"} been open for ${minutesLabel(minutes)}.`,
    level: "warning",
  }),
};

const LOCK_COPY: TimedCopy = {
  alert: (name, _labels, minutes) => ({
    title: "Vehicle unlocked",
    body: `${name} has been unlocked for ${minutesLabel(minutes)}.`,
    level: "warning",
  }),
};
