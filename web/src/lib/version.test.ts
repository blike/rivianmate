import { describe, expect, it } from "vitest";
import { shortCommit, versionLabel } from "./version.js";

describe("version labels", () => {
  it("prefixes the version with v", () => {
    expect(versionLabel({ version: "0.3.0", commit: null })).toBe("v0.3.0");
    expect(versionLabel({ version: null, commit: null })).toBe("unknown");
    expect(versionLabel(undefined)).toBe("unknown");
  });

  it("shortens commits to 7 characters", () => {
    expect(shortCommit("1e52ce4a912b07c29ecf6a23e8e45ec77e000000")).toBe("1e52ce4");
    expect(shortCommit(null)).toBeNull();
  });
});
