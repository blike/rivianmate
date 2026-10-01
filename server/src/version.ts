import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { VersionResponse } from "./api-types.js";

const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;

/**
 * The running app's version. `version` comes from package.json (bumped for
 * each release); `commit` is baked into the Docker image at build time, so
 * builds between releases can be told apart.
 */
export function loadVersion(env: NodeJS.ProcessEnv = process.env): VersionResponse {
  // src/version.ts in dev and dist/version.js in the image both sit one
  // level below the server's package.json.
  const packagePath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  let version: string | null = null;
  try {
    const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
    if (typeof pkg.version === "string") version = pkg.version;
  } catch {
    // Unknown version is better than failing to start.
  }
  const commit = env.GIT_COMMIT?.trim();
  return { version, commit: commit && COMMIT_PATTERN.test(commit) ? commit.toLowerCase() : null };
}
