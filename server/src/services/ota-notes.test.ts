import { describe, expect, it } from "vitest";
import { releaseNotesVersion, safeUrl } from "./ota-notes.js";

const v = (value: string) => ({ timeStamp: "t", value });

describe("releaseNotesVersion", () => {
  it("prefers a pending update", () => {
    expect(
      releaseNotesVersion({ otaCurrentVersion: v("2026.30.0"), otaAvailableVersion: v("2026.34.1") }),
    ).toBe("2026.34.1");
  });

  it("falls back to the installed version", () => {
    expect(
      releaseNotesVersion({ otaCurrentVersion: v("2026.30.0"), otaAvailableVersion: v("0.0.0") }),
    ).toBe("2026.30.0");
    expect(
      releaseNotesVersion({ otaCurrentVersion: v("2026.30.0"), otaAvailableVersion: v("2026.30.0") }),
    ).toBe("2026.30.0");
  });

  it("returns null without a usable version", () => {
    expect(releaseNotesVersion({})).toBeNull();
    expect(releaseNotesVersion({ otaCurrentVersion: v("0.0.0") })).toBeNull();
  });
});

describe("safeUrl", () => {
  it("only allows https links", () => {
    expect(safeUrl("https://rivian.com/notes")).toBe("https://rivian.com/notes");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("http://example.com")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});
