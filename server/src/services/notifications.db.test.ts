/** Integration test against a real Postgres; skipped unless TEST_DATABASE_URL is set. */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenCrypto } from "../crypto.js";
import { createDb, runMigrations } from "../db/client.js";
import { appSettings } from "../db/schema.js";
import type { VehicleState } from "../rivian/types.js";
import { DEFAULT_EVENTS, NotificationService, NotificationSettingsError } from "./notifications.js";

const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

const v = (value: string) => ({ timeStamp: "t", value });
const vehicle = { id: "v1", vin: "VIN1", name: "R1S", make: null, model: "R1S", modelYear: null, supportedFeatures: [] };
const DISCORD = "https://discord.com/api/webhooks/1/secret";

describe.skipIf(!url)("NotificationService with Postgres", () => {
  let handle: ReturnType<typeof createDb>;
  const crypto = new TokenCrypto("x".repeat(32));

  beforeAll(async () => {
    await runMigrations(url!, join(here, "..", "..", "drizzle"));
    handle = createDb(url!);
  });
  afterAll(async () => {
    await handle.sql.end();
  });
  beforeEach(async () => {
    await handle.sql`TRUNCATE app_settings, wallboxes RESTART IDENTITY CASCADE`;
  });

  const service = (state: { current: VehicleState }) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const svc = new NotificationService(
      handle.db,
      crypto,
      () => [vehicle],
      () => state.current,
      () => {},
      fetchImpl as unknown as typeof fetch,
    );
    return { svc, fetchImpl };
  };

  it("stores webhook URLs encrypted and only shows a preview", async () => {
    const { svc } = service({ current: {} });
    const saved = await svc.saveSettings({
      enabled: true,
      destinations: [
        { kind: "discord", name: "Family", url: DISCORD },
        { kind: "discord", name: null, url: "https://discord.com/api/webhooks/2/other" },
      ],
      appUrl: null,
      events: DEFAULT_EVENTS,
    });
    expect(saved.destinations.map((d) => [d.kind, d.name, d.preview])).toEqual([
      ["discord", "Family", "discord.com/api/webhooks/…"],
      ["discord", null, "discord.com/api/webhooks/…"],
    ]);
    const [row] = await handle.db.select().from(appSettings);
    expect(row!.value).not.toContain("secret");

    // Kept by id (and renamed); left-out destinations are removed.
    const [first] = saved.destinations;
    const kept = await svc.saveSettings({
      enabled: true,
      destinations: [{ id: first!.id, kind: "discord", name: "Home" }],
      appUrl: null,
      events: DEFAULT_EVENTS,
    });
    expect(kept.destinations).toEqual([{ ...first, name: "Home" }]);
    await expect(
      svc.saveSettings({ enabled: true, destinations: [{ kind: "discord", name: null, url: "https://x.example" }], appUrl: null, events: DEFAULT_EVENTS }),
    ).rejects.toThrow(NotificationSettingsError);
    await expect(
      svc.saveSettings({ enabled: true, destinations: [{ id: "nope", kind: "discord", name: null }], appUrl: null, events: DEFAULT_EVENTS }),
    ).rejects.toThrow(NotificationSettingsError);
  });

  it("sends alerts once, even across restarts", async () => {
    const state = { current: { otaCurrentVersion: v("2026.31.0"), otaAvailableVersion: v("0.0.0") } as VehicleState };
    const first = service(state);
    await first.svc.saveSettings({ enabled: true, destinations: [{ kind: "discord", name: null, url: DISCORD }], appUrl: null, events: DEFAULT_EVENTS });
    await first.svc.check("v1");
    state.current = { otaCurrentVersion: v("2026.31.0"), otaAvailableVersion: v("2026.36.0") };
    await first.svc.check("v1");
    expect(first.fetchImpl).toHaveBeenCalledTimes(1);

    // A restarted service remembers it already announced 2026.36.0.
    const second = service(state);
    await second.svc.check("v1");
    expect(second.fetchImpl).not.toHaveBeenCalled();
  });

  it("tracks changes but sends nothing while turned off", async () => {
    const state = { current: { otaCurrentVersion: v("2026.31.0"), otaAvailableVersion: v("0.0.0") } as VehicleState };
    const { svc, fetchImpl } = service(state);
    await svc.saveSettings({ enabled: false, destinations: [{ kind: "discord", name: null, url: DISCORD }], appUrl: null, events: DEFAULT_EVENTS });
    await svc.check("v1");
    state.current = { otaCurrentVersion: v("2026.31.0"), otaAvailableVersion: v("2026.36.0") };
    await svc.check("v1");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await svc.test()).toEqual([{ id: expect.any(String), kind: "discord", name: null, ok: true, error: null }]);
  });
});
