import type { RivianApi } from "../rivian/client.js";
import { type OtaUpdateDetails, isGraphqlValidationError } from "../rivian/types.js";

/**
 * Rivian's links are presigned for an hour; reuse a fetch for well under
 * that so a link handed out is never close to expiring.
 */
const CACHE_MS = 20 * 60_000;

/** Only plain https links are handed out. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** The release-notes link for `version`, if it's the installed or pending one. */
export function notesUrlFor(details: OtaUpdateDetails, version: string): string | null {
  for (const notes of [details.available, details.current]) {
    if (notes?.version === version) return safeUrl(notes.url);
  }
  return null;
}

/**
 * Looks up release notes on demand. Rivian only describes the installed and
 * pending versions, and its links expire, so nothing is stored.
 */
export class OtaNotesResolver {
  private cache = new Map<string, { at: number; details: Promise<OtaUpdateDetails> }>();
  private unsupported = false;

  constructor(
    private readonly api: RivianApi,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  async notesUrl(vehicleId: string, version: string): Promise<string | null> {
    if (this.unsupported) return null;
    const hit = this.cache.get(vehicleId);
    let details = hit && Date.now() - hit.at < CACHE_MS ? hit.details : undefined;
    if (!details) {
      details = this.api.getOtaUpdateDetails(vehicleId);
      this.cache.set(vehicleId, { at: Date.now(), details });
    }
    try {
      return notesUrlFor(await details, version);
    } catch (err) {
      this.cache.delete(vehicleId);
      if (isGraphqlValidationError(err)) {
        this.unsupported = true;
        this.log("OTA release notes query not supported; disabling");
        return null;
      }
      this.log(`OTA release notes fetch failed: ${(err as Error).message}`);
      return null;
    }
  }
}
