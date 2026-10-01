import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { loadVersion } from "./version.js";

describe("loadVersion", () => {
  it("reads the package version and a valid build commit", () => {
    const sha = "1E52CE4A912B07".padEnd(40, "0");
    expect(loadVersion({ GIT_COMMIT: sha })).toEqual({
      version: pkg.version,
      commit: sha.toLowerCase(),
    });
  });

  it("ignores a missing or malformed commit", () => {
    expect(loadVersion({}).commit).toBeNull();
    expect(loadVersion({ GIT_COMMIT: "not-a-sha" }).commit).toBeNull();
  });
});
