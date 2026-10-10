import type { VehicleState } from "@server/api-types.js";
import { describe, expect, it } from "vitest";
import { installTimeLabel, lastInstallFailed, softwareUpdate } from "./ota.js";

const v = (value: string | number) => ({ timeStamp: "t", value });
const state = (fields: Record<string, string | number>) =>
  Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, v(x)])) as unknown as VehicleState;

const base = { otaCurrentVersion: "2026.31.0", otaAvailableVersion: "2026.36.0" };

describe("softwareUpdate", () => {
  it("is null when up to date", () => {
    expect(softwareUpdate(state({ otaCurrentVersion: "2026.31.0", otaAvailableVersion: "0.0.0", otaStatus: "Idle" }))).toBeNull();
    expect(softwareUpdate(state({ otaCurrentVersion: "2026.31.0", otaAvailableVersion: "2026.31.0" }))).toBeNull();
    expect(softwareUpdate(undefined)).toBeNull();
  });

  it("reads a downloaded update as ready, with its details", () => {
    expect(
      softwareUpdate(state({ ...base, otaStatus: "Ready_To_Install", otaInstallDuration: 65, otaInstallType: "Convenience", otaDownloadProgress: 0 })),
    ).toEqual({
      version: "2026.36.0",
      phase: "ready",
      progress: null,
      installMinutes: 65,
      type: "Convenience",
      label: "Ready to install",
    });
  });

  it("shows download and install progress", () => {
    expect(softwareUpdate(state({ ...base, otaStatus: "Idle", otaDownloadProgress: 42 }))).toMatchObject({ phase: "downloading", label: "Downloading · 42%" });
    expect(softwareUpdate(state({ ...base, otaStatus: "Installing", otaInstallProgress: 37.6 }))).toMatchObject({ phase: "installing", label: "Installing · 38%" });
    expect(softwareUpdate(state({ ...base, otaStatus: "Idle" }))).toMatchObject({ phase: "available", label: "Update available" });
  });

  it("keeps showing an install when the pending version drops out", () => {
    expect(softwareUpdate(state({ otaCurrentVersion: "2026.31.0", otaAvailableVersion: "0.0.0", otaInstallProgress: 10 }))).toMatchObject({ phase: "installing", version: null });
  });
});

describe("lastInstallFailed", () => {
  it("flags failures only", () => {
    expect(lastInstallFailed(state({ otaCurrentStatus: "Install_Success" }))).toBe(false);
    expect(lastInstallFailed(state({ otaCurrentStatus: "Install_Failed" }))).toBe(true);
  });
});

describe("installTimeLabel", () => {
  it("formats minutes", () => {
    expect(installTimeLabel(25)).toBe("About 25 min");
    expect(installTimeLabel(60)).toBe("About 1 hr");
    expect(installTimeLabel(65)).toBe("About 1 hr 5 min");
  });
});
