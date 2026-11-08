import { createInterface } from 'node:readline';
import { type Entry, type ZipFile, openPromise } from 'yauzl';

/** The archive layout this reads; a later one may move or rename things. */
const FORMAT_VERSION = 1;
const MANIFEST = 'manifest.json';
/** The manifest is a listing; anything near this is something else. */
const MAX_MANIFEST_BYTES = 64 * 1024 ** 2;

export class NotARoamerExportError extends Error {
  constructor(message = "This doesn't look like a Rivian Roamer export: it has no manifest.") {
    super(message);
  }
}

interface ManifestFile {
  dataset: string;
  rows?: number;
  /** The span of time a telemetry file holds. */
  from?: string;
  until?: string;
}

interface Manifest {
  format_version: number;
  files: Record<string, ManifestFile>;
}

export interface ReadStats {
  unreadable: number;
}

/**
 * A Roamer export, read in place: telemetry stays compressed in the zip and
 * is streamed out file by file, a line (one JSON object) at a time.
 */
export class RoamerArchive {
  private constructor(
    private readonly zip: ZipFile,
    private readonly entries: ReadonlyMap<string, Entry>,
    private readonly manifest: Manifest,
  ) {}

  /** Raises NotARoamerExportError unless the zip has a manifest this can read. */
  static async open(path: string): Promise<RoamerArchive> {
    const zip = await openPromise(path, { lazyEntries: true, autoClose: false });
    try {
      const entries = new Map<string, Entry>();
      for await (const entry of zip.eachEntry()) entries.set(entry.fileName, entry);
      const listing = entries.get(MANIFEST);
      if (!listing || listing.uncompressedSize > MAX_MANIFEST_BYTES) {
        throw new NotARoamerExportError();
      }
      const chunks: Buffer[] = [];
      for await (const chunk of await zip.openReadStreamPromise(listing)) {
        chunks.push(chunk as Buffer);
      }
      let manifest: Manifest;
      try {
        manifest = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Manifest;
      } catch {
        throw new NotARoamerExportError();
      }
      if (manifest.format_version !== FORMAT_VERSION || typeof manifest.files !== 'object') {
        throw new NotARoamerExportError(
          'This Rivian Roamer export is in a format RivianMate doesn’t know yet.',
        );
      }
      return new RoamerArchive(zip, entries, manifest);
    } catch (err) {
      zip.close();
      throw err;
    }
  }

  close(): void {
    this.zip.close();
  }

  /**
   * A dataset's files, in time order: the account-wide file at the top, or a
   * vehicle's, which telemetry splits into one per stretch of time.
   */
  files(dataset: string, vehicleId?: string): string[] {
    const prefix = vehicleId == null ? null : `vehicles/${vehicleId}/`;
    return Object.entries(this.manifest.files)
      .filter(
        ([name, file]) =>
          file.dataset === dataset &&
          this.entries.has(name) &&
          (prefix == null ? !name.includes('/') : name.startsWith(prefix)),
      )
      .sort(([a, x], [b, y]) => (x.from ?? '').localeCompare(y.from ?? '') || a.localeCompare(b))
      .map(([name]) => name);
  }

  /** How many records the manifest says the files hold. */
  rowsIn(names: readonly string[]): number {
    return names.reduce((sum, name) => sum + (this.manifest.files[name]?.rows ?? 0), 0);
  }

  /** Each record of the files in turn; a line that isn't a JSON object is counted and skipped. */
  async *records(
    names: readonly string[],
    stats: ReadStats = { unreadable: 0 },
  ): AsyncGenerator<Record<string, unknown>> {
    for (const name of names) {
      const entry = this.entries.get(name);
      if (!entry) continue;
      const input = await this.zip.openReadStreamPromise(entry);
      const lines = createInterface({ input, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (line.trim() === '') continue;
          let record: unknown;
          try {
            record = JSON.parse(line);
          } catch {
            record = null;
          }
          if (record && typeof record === 'object' && !Array.isArray(record)) {
            yield record as Record<string, unknown>;
          } else {
            stats.unreadable += 1;
          }
        }
      } finally {
        lines.close();
        // A reader that stops early leaves the rest of the file unread.
        input.destroy();
      }
    }
  }
}
