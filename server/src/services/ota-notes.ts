import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { otaReleaseNotes } from "../db/schema.js";
import type { RivianApi } from "../rivian/client.js";
import { type VehicleState, isGraphqlValidationError } from "../rivian/types.js";
import { stateString } from "./state-utils.js";

const NO_VERSION = new Set(["", "0.0.0"]);

/**
 * Version the release-notes link most likely describes: the pending update
 * when one is available, otherwise what's installed.
 */
export function releaseNotesVersion(state: VehicleState): string | null {
  const current = stateString(state, "otaCurrentVersion")?.trim() ?? "";
  const available = stateString(state, "otaAvailableVersion")?.trim() ?? "";
  if (!NO_VERSION.has(available) && available !== current) return available;
  return NO_VERSION.has(current) ? null : current;
}

/** Only plain https links are shown in the UI. */
export function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Fetches Rivian's release-notes link once per (vehicle, version): at most
 * one request whenever the installed or available version changes.
 */
export class OtaNotesTracker {
  private checked = new Map<string, string>();
  private unsupported = false;

  constructor(
    private readonly db: Db,
    private readonly api: RivianApi,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  async check(vehicleId: string, state: VehicleState): Promise<void> {
    if (this.unsupported) return;
    const version = releaseNotesVersion(state);
    if (!version || this.checked.get(vehicleId) === version) return;
    this.checked.set(vehicleId, version);

    const existing = await this.db
      .select({ url: otaReleaseNotes.url })
      .from(otaReleaseNotes)
      .where(and(eq(otaReleaseNotes.vehicleId, vehicleId), eq(otaReleaseNotes.version, version)))
      .limit(1);
    if (existing[0]) return;

    try {
      const url = safeUrl(await this.api.getOtaReleaseNotesUrl(vehicleId));
      if (!url) return;
      await this.db
        .insert(otaReleaseNotes)
        .values({ vehicleId, version, url })
        .onConflictDoUpdate({
          target: [otaReleaseNotes.vehicleId, otaReleaseNotes.version],
          set: { url, fetchedAt: new Date() },
        });
    } catch (err) {
      if (isGraphqlValidationError(err)) {
        this.unsupported = true;
        this.log("OTA release notes query not supported; disabling");
        return;
      }
      // Try again on the next version change or restart.
      this.checked.delete(vehicleId);
      this.log(`OTA release notes fetch failed: ${(err as Error).message}`);
    }
  }
}
