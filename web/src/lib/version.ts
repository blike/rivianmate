import type { VersionResponse } from "@server/api-types.js";

export const REPO_URL = "https://github.com/blike/rivianmate";

/** "v0.3.0", or "unknown" if the server couldn't read its version. */
export function versionLabel(info: VersionResponse | undefined): string {
  return info?.version ? `v${info.version}` : "unknown";
}

export function shortCommit(commit: string | null | undefined): string | null {
  return commit ? commit.slice(0, 7) : null;
}
