import type { VehicleState } from "@server/api-types.js";
import { nv, sv, titleCase } from "./state.js";

export type OtaPhase = "available" | "downloading" | "ready" | "installing";

export interface SoftwareUpdate {
  /** Pending version; null if the vehicle stops reporting it mid-install. */
  version: string | null;
  phase: OtaPhase;
  /** 0–100 while downloading or installing. */
  progress: number | null;
  /** The vehicle's install-time estimate. */
  installMinutes: number | null;
  /** Rivian's category for the update, e.g. "Convenience". */
  type: string | null;
  label: string;
}

const NO_VERSION = new Set(["", "0.0.0"]);

const PHASE_LABEL: Record<OtaPhase, string> = {
  available: "Update available",
  downloading: "Downloading",
  ready: "Ready to install",
  installing: "Installing",
};

const inProgress = (n: number | null): n is number => n != null && n > 0 && n < 100;

/**
 * A software update that's pending, downloading, ready or installing, if
 * any. Progress percentages win over status strings, since Rivian's status
 * vocabulary is only partly known (observed: Idle, Ready_To_Install).
 */
export function softwareUpdate(state: VehicleState | undefined): SoftwareUpdate | null {
  const current = sv(state, "otaCurrentVersion");
  const availableRaw = sv(state, "otaAvailableVersion");
  const available =
    availableRaw && !NO_VERSION.has(availableRaw) && availableRaw !== current ? availableRaw : null;
  const status = (sv(state, "otaStatus") ?? "").toLowerCase();
  const download = nv(state, "otaDownloadProgress");
  const install = nv(state, "otaInstallProgress");

  let phase: OtaPhase | null = null;
  let progress: number | null = null;
  if (inProgress(install) || (status.includes("install") && !status.includes("ready"))) {
    phase = "installing";
    progress = inProgress(install) ? install : null;
  } else if (inProgress(download) || status.includes("download")) {
    phase = "downloading";
    progress = inProgress(download) ? download : null;
  } else if (available) {
    phase = status.includes("ready") ? "ready" : "available";
  }
  if (!phase) return null;

  const duration = nv(state, "otaInstallDuration");
  const type = sv(state, "otaInstallType");
  return {
    version: available,
    phase,
    progress,
    installMinutes: duration != null && duration > 0 ? duration : null,
    type: type ? titleCase(type) : null,
    label: PHASE_LABEL[phase] + (progress != null ? ` · ${Math.round(progress)}%` : ""),
  };
}

/** True when the vehicle reports the last install didn't succeed. */
export function lastInstallFailed(state: VehicleState | undefined): boolean {
  return /fail|error/i.test(sv(state, "otaCurrentStatus") ?? "");
}

/** "65 min" → "About 1 hr 5 min". */
export function installTimeLabel(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `About ${m} min`;
  const h = Math.floor(m / 60);
  return `About ${h} hr${m % 60 ? ` ${m % 60} min` : ""}`;
}

/** Server route serving the saved copy of Rivian's release notes. */
export function releaseNotesHref(vehicleId: string, version: string): string {
  return `/api/vehicles/${encodeURIComponent(vehicleId)}/ota/notes/${encodeURIComponent(version)}`;
}

const DAY_MS = 86_400_000;

/**
 * Median days between updates, from versions newest first. The oldest
 * version's date is when tracking began, not an install, so it's left out.
 */
export function typicalUpdateGapDays(versions: readonly { firstSeen: string }[]): number | null {
  const installs = versions.slice(0, -1).map((v) => Date.parse(v.firstSeen));
  const gaps: number[] = [];
  for (let i = 0; i < installs.length - 1; i++) gaps.push((installs[i]! - installs[i + 1]!) / DAY_MS);
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const mid = gaps.length / 2;
  return gaps.length % 2 ? gaps[Math.floor(mid)]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
}
