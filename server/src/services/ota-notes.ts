import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { otaReleaseNotes } from "../db/schema.js";
import type { RivianApi } from "../rivian/client.js";
import { type OtaUpdateDetails, type VehicleState, isGraphqlValidationError } from "../rivian/types.js";
import { stateString } from "./state-utils.js";

const NO_VERSION = new Set(["", "0.0.0"]);
/** Release notes run to tens of kilobytes; anything far larger isn't one. */
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

/** Only plain https links are followed. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** The installed and pending versions the vehicle reports. */
export function reportedVersions(state: VehicleState): string[] {
  const versions = ["otaCurrentVersion", "otaAvailableVersion"]
    .map((key) => stateString(state, key)?.trim() ?? "")
    .filter((v) => !NO_VERSION.has(v));
  return [...new Set(versions)];
}

/** Notes Rivian offered that aren't stored yet, with usable links. */
export function notesToDownload(
  details: OtaUpdateDetails,
  stored: ReadonlySet<string>,
): { version: string; url: string }[] {
  const out: { version: string; url: string }[] = [];
  for (const notes of [details.current, details.available]) {
    const url = safeUrl(notes?.url);
    const version = notes?.version?.trim();
    if (url && version && !stored.has(version) && !out.some((n) => n.version === version)) {
      out.push({ version, url });
    }
  }
  return out;
}

/** Downloads a release-notes PDF; null if it isn't one. */
export async function downloadPdf(url: string, fetchImpl: typeof fetch = fetch): Promise<Buffer | null> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`release notes download failed: HTTP ${res.status}`);
  const length = Number(res.headers.get("content-length"));
  if (length > MAX_PDF_BYTES) return null;
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_PDF_BYTES || body.subarray(0, 5).toString("latin1") !== "%PDF-") return null;
  return body;
}

/**
 * Keeps a copy of each version's release notes. Rivian only offers notes for
 * the installed and pending versions, through links that expire within the
 * hour, so they're saved as soon as a version is seen and served from here.
 */
export class OtaNotesStore {
  private api?: RivianApi;
  /** Versions last checked per vehicle, so an unchanged state costs nothing. */
  private checked = new Map<string, string>();
  private inFlight = new Map<string, Promise<void>>();
  private unsupported = false;

  constructor(
    private readonly db: Db,
    private readonly log: (msg: string) => void = () => {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Rivian API for fetching new notes; undefined while disconnected. */
  connect(api: RivianApi | undefined): void {
    this.api = api;
    this.checked.clear();
  }

  /** Saves notes for the vehicle's installed and pending versions if missing. */
  async capture(vehicleId: string, state: VehicleState): Promise<void> {
    const versions = reportedVersions(state);
    const key = versions.join("|");
    if (!this.api || this.unsupported || versions.length === 0 || this.checked.get(vehicleId) === key) return;
    this.checked.set(vehicleId, key);
    // One fetch at a time per vehicle; a newer state waits for the last.
    const task = (this.inFlight.get(vehicleId) ?? Promise.resolve())
      .then(() => this.fetchMissing(vehicleId, versions))
      .finally(() => {
        if (this.inFlight.get(vehicleId) === task) this.inFlight.delete(vehicleId);
      });
    this.inFlight.set(vehicleId, task);
    return task;
  }

  async pdf(vehicleId: string, version: string): Promise<Buffer | null> {
    const rows = await this.db
      .select({ pdf: otaReleaseNotes.pdf })
      .from(otaReleaseNotes)
      .where(and(eq(otaReleaseNotes.vehicleId, vehicleId), eq(otaReleaseNotes.version, version)))
      .limit(1);
    return rows[0]?.pdf ?? null;
  }

  async storedVersions(vehicleId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ version: otaReleaseNotes.version })
      .from(otaReleaseNotes)
      .where(eq(otaReleaseNotes.vehicleId, vehicleId));
    return new Set(rows.map((r) => r.version));
  }

  private async fetchMissing(vehicleId: string, versions: string[]): Promise<void> {
    const stored = await this.storedVersions(vehicleId);
    if (versions.every((v) => stored.has(v)) || !this.api) return;
    try {
      const details = await this.api.getOtaUpdateDetails(vehicleId);
      for (const { version, url } of notesToDownload(details, stored)) {
        const pdf = await downloadPdf(url, this.fetchImpl);
        if (!pdf) {
          this.log(`OTA release notes for ${version} weren't a PDF; skipping`);
          continue;
        }
        await this.db.insert(otaReleaseNotes).values({ vehicleId, version, pdf }).onConflictDoNothing();
      }
    } catch (err) {
      if (isGraphqlValidationError(err)) {
        this.unsupported = true;
        this.log("OTA release notes query not supported; disabling");
        return;
      }
      // Try again on the next state change or request.
      this.checked.delete(vehicleId);
      this.log(`OTA release notes fetch failed: ${(err as Error).message}`);
    }
  }
}
