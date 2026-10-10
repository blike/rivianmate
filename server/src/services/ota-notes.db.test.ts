/** Integration test against a real Postgres; skipped unless TEST_DATABASE_URL is set. */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, runMigrations } from "../db/client.js";
import { vehicles } from "../db/schema.js";
import type { RivianApi } from "../rivian/client.js";
import { OtaNotesStore } from "./ota-notes.js";

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

const v = (value: string) => ({ timeStamp: "t", value });
const state = (current: string, available: string) => ({
  otaCurrentVersion: v(current),
  otaAvailableVersion: v(available),
});
const notes = (version: string) => ({ url: `https://docs.example/${version}.pdf`, version, locale: "en-US" });

describe.skipIf(!url)("OtaNotesStore with Postgres", () => {
  let handle: ReturnType<typeof createDb>;

  beforeAll(async () => {
    await runMigrations(url!, join(here, "..", "..", "drizzle"));
    handle = createDb(url!);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE ota_release_notes, vehicles RESTART IDENTITY CASCADE`;
    await handle.db.insert(vehicles).values({ id: "v1", vin: "VIN1" });
  });

  const setup = () => {
    const getOtaUpdateDetails = vi.fn(async () => ({ current: notes("2026.31.0"), available: notes("2026.36.0") }));
    const fetchImpl = vi.fn(async (input: string | URL | Request) => new Response(`%PDF-1.7 ${String(input)}`));
    const store = new OtaNotesStore(handle.db, () => {}, fetchImpl as unknown as typeof fetch);
    store.connect({ getOtaUpdateDetails } as unknown as RivianApi);
    return { store, getOtaUpdateDetails, fetchImpl };
  };

  it("saves notes for the installed and pending versions", async () => {
    const { store } = setup();
    await store.capture("v1", state("2026.31.0", "2026.36.0"));
    expect(await store.storedVersions("v1")).toEqual(new Set(["2026.31.0", "2026.36.0"]));
    expect((await store.pdf("v1", "2026.36.0"))?.toString()).toBe("%PDF-1.7 https://docs.example/2026.36.0.pdf");
  });

  it("asks Rivian only when a version's notes are missing", async () => {
    const { store, getOtaUpdateDetails } = setup();
    await store.capture("v1", state("2026.31.0", "2026.36.0"));
    await store.capture("v1", state("2026.31.0", "2026.36.0"));
    // After installing, the old notes stay and nothing new is needed.
    await store.capture("v1", state("2026.36.0", "0.0.0"));
    expect(getOtaUpdateDetails).toHaveBeenCalledTimes(1);
    expect(await store.pdf("v1", "2026.31.0")).not.toBeNull();
  });
});
