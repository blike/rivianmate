import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type {
  NotificationChannelKind,
  NotificationEvents,
  NotificationSettingsDto,
  NotificationSettingsUpdate,
  NotificationTestResult,
} from "../api-types.js";
import type { TokenCrypto } from "../crypto.js";
import type { Db } from "../db/client.js";
import { appSettings, wallboxes } from "../db/schema.js";
import type { VehicleState } from "../rivian/types.js";
import { getHomeChargingSettings, getUnitPreferences } from "../routes/settings.js";
import { type Spot, homeSpots, nearbySpot } from "./home-charging.js";
import type { LiveBus } from "./live-bus.js";
import { type RuleState, emptyRuleState, evaluateRules } from "./notification-rules.js";
import { type Alert, channelUrlProblem, previewUrl, sendAlert } from "./notify-channels.js";
import { stateLocation } from "./state-utils.js";
import type { MonitoredVehicle } from "./vehicle-monitor.js";

const SETTINGS_KEY = "notifications";
const stateKey = (vehicleId: string) => `notification_state:${vehicleId}`;
/** Timed alerts need checking even when nothing changes. */
const TICK_MS = 30_000;
const HOME_CACHE_MS = 5 * 60_000;
const MAX_DESTINATIONS = 10;
const KIND_NAME: Record<NotificationChannelKind, string> = { apprise: "Apprise", discord: "Discord" };

export const DEFAULT_EVENTS: NotificationEvents = {
  doorOpen: { enabled: true, minutes: 5, awayOnly: false },
  windowOpen: { enabled: true, minutes: 5, awayOnly: false },
  unlocked: { enabled: true, minutes: 10, awayOnly: true },
  tirePressure: { enabled: true },
  updateAvailable: { enabled: true },
  updateInstalled: { enabled: true },
  updateFailed: { enabled: true },
  chargingComplete: { enabled: false },
  lowBattery: { enabled: false, percent: 20 },
};

const toggle = z.object({ enabled: z.boolean() });
const timedSchema = z.object({
  enabled: z.boolean(),
  minutes: z.number().int().min(1).max(24 * 60),
  awayOnly: z.boolean(),
});
const eventsSchema = z.object({
  doorOpen: timedSchema,
  windowOpen: timedSchema,
  unlocked: timedSchema,
  tirePressure: toggle,
  updateAvailable: toggle,
  updateInstalled: toggle,
  updateFailed: toggle,
  chargingComplete: toggle,
  lowBattery: z.object({ enabled: z.boolean(), percent: z.number().int().min(1).max(90) }),
});

const kindSchema = z.enum(["apprise", "discord"]);
const nameSchema = z
  .string()
  .trim()
  .max(60)
  .nullable()
  .transform((n) => n || null);

export const settingsUpdateSchema = z.object({
  enabled: z.boolean(),
  destinations: z
    .array(
      z.object({
        id: z.string().max(64).optional(),
        kind: kindSchema,
        name: nameSchema,
        url: z.string().trim().max(2048).optional(),
      }),
    )
    .max(MAX_DESTINATIONS),
  appUrl: z.string().trim().max(512).nullable(),
  events: eventsSchema,
});

/** An http(s) origin plus optional path, without a trailing slash; null if invalid. */
export function normalizeAppUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** As stored: URLs encrypted, since webhook URLs carry a secret. */
const storedSchema = z.object({
  enabled: z.boolean(),
  destinations: z
    .array(z.object({ id: z.string(), kind: kindSchema, name: z.string().nullable(), urlEnc: z.string() }))
    .default([]),
  appUrl: z.string().nullable().default(null),
  // Older saves may lack newer events; fill them from the defaults.
  events: z.record(z.string(), z.unknown()),
});
type Stored = z.infer<typeof storedSchema>;

interface Destination {
  id: string;
  kind: NotificationChannelKind;
  name: string | null;
  url: string;
}

interface ResolvedSettings {
  enabled: boolean;
  destinations: Destination[];
  appUrl: string | null;
  events: NotificationEvents;
}

const label = (d: Pick<Destination, "kind" | "name">) => d.name ?? KIND_NAME[d.kind];

export class NotificationSettingsError extends Error {}

export class NotificationService {
  private ruleStates = new Map<string, RuleState>();
  private savedStates = new Map<string, string>();
  private queues = new Map<string, Promise<void>>();
  private settings?: Promise<ResolvedSettings>;
  private home?: { at: number; spots: Promise<Spot[]>; pressure: Promise<"psi" | "bar"> };
  private timer?: NodeJS.Timeout;
  private unsubscribe?: () => void;

  constructor(
    private readonly db: Db,
    private readonly crypto: TokenCrypto,
    private readonly vehicles: () => readonly MonitoredVehicle[],
    private readonly getState: (vehicleId: string) => VehicleState | undefined,
    private readonly log: (msg: string) => void = () => {},
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  start(bus: LiveBus): void {
    this.unsubscribe = bus.onState((vehicleId) => this.check(vehicleId));
    this.timer = setInterval(() => {
      for (const v of this.vehicles()) this.check(v.id);
    }, TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    this.unsubscribe?.();
    if (this.timer) clearInterval(this.timer);
  }

  /** Evaluates a vehicle's latest state; runs one at a time per vehicle. */
  check(vehicleId: string): Promise<void> {
    const task = (this.queues.get(vehicleId) ?? Promise.resolve())
      .then(() => this.evaluate(vehicleId))
      .catch((err) => this.log(`notification check failed: ${(err as Error).message}`));
    this.queues.set(vehicleId, task);
    return task;
  }

  async getSettings(): Promise<NotificationSettingsDto> {
    const s = await this.resolved();
    const spots = await this.homeSpots();
    return {
      enabled: s.enabled,
      destinations: s.destinations.map(({ id, kind, name, url }) => ({ id, kind, name, preview: previewUrl(url) })),
      appUrl: s.appUrl,
      events: s.events,
      homeKnown: spots.length > 0,
    };
  }

  async saveSettings(update: NotificationSettingsUpdate): Promise<NotificationSettingsDto> {
    const current = await this.resolved();
    const destinations: Destination[] = update.destinations.map((d) => {
      const name = d.name?.trim() || null;
      if (d.url) {
        const problem = channelUrlProblem(d.kind, d.url);
        if (problem) throw new NotificationSettingsError(`${name ?? KIND_NAME[d.kind]}: ${problem}`);
        return { id: d.id ?? randomUUID(), kind: d.kind, name, url: d.url };
      }
      const saved = current.destinations.find((c) => c.id === d.id && c.kind === d.kind);
      if (!saved) throw new NotificationSettingsError(`${name ?? KIND_NAME[d.kind]}: enter a URL`);
      return { ...saved, name };
    });
    const appUrl = update.appUrl ? normalizeAppUrl(update.appUrl) : null;
    if (update.appUrl && !appUrl) throw new NotificationSettingsError("RivianMate address: use an http(s) URL");
    const stored: Stored = {
      enabled: update.enabled,
      appUrl,
      destinations: destinations.map(({ id, kind, name, url }) => ({ id, kind, name, urlEnc: this.crypto.encrypt(url) })),
      events: update.events as unknown as Record<string, unknown>,
    };
    const value = JSON.stringify(stored);
    await this.db
      .insert(appSettings)
      .values({ key: SETTINGS_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } });
    this.settings = undefined;
    this.home = undefined;
    return this.getSettings();
  }

  /** Sends a test alert to every destination. */
  async test(): Promise<NotificationTestResult[]> {
    const s = await this.resolved();
    const alert: Alert = {
      title: "RivianMate test",
      body: "Notifications are set up. Alerts for your vehicle will arrive here.",
      level: "info",
    };
    return Promise.all(
      s.destinations.map(async (d): Promise<NotificationTestResult> => {
        const result = { id: d.id, kind: d.kind, name: d.name };
        try {
          await sendAlert(d.kind, d.url, alert, this.fetchImpl);
          return { ...result, ok: true, error: null };
        } catch (err) {
          return { ...result, ok: false, error: (err as Error).message };
        }
      }),
    );
  }

  private async evaluate(vehicleId: string): Promise<void> {
    const state = this.getState(vehicleId);
    const vehicle = this.vehicles().find((v) => v.id === vehicleId);
    if (!state || !vehicle || Object.keys(state).length === 0) return;

    const settings = await this.resolved();
    const prev = await this.ruleState(vehicleId);
    const loc = stateLocation(state);
    const spots = await this.homeSpots();
    const atHome = loc && spots.length > 0 ? nearbySpot(loc.latitude, loc.longitude, spots) !== null : null;

    const { next, alerts } = evaluateRules(prev, {
      state,
      now: this.now(),
      events: settings.events,
      vehicleName: vehicle.name ?? vehicle.model ?? "Your vehicle",
      model: vehicle.model,
      atHome,
      pressureUnit: await this.home!.pressure,
      notesUrl: (version) =>
        settings.appUrl
          ? `${settings.appUrl}/api/vehicles/${encodeURIComponent(vehicleId)}/ota/notes/${encodeURIComponent(version)}`
          : null,
    });
    this.ruleStates.set(vehicleId, next);
    await this.persist(vehicleId, next);

    if (!settings.enabled) return;
    for (const alert of alerts) await this.deliver(settings, alert);
  }

  private async deliver(settings: ResolvedSettings, alert: Alert): Promise<void> {
    await Promise.all(
      settings.destinations.map((d) =>
        sendAlert(d.kind, d.url, alert, this.fetchImpl).catch((err: unknown) =>
          this.log(`${label(d)} alert "${alert.title}" failed: ${(err as Error).message}`),
        ),
      ),
    );
  }

  private async ruleState(vehicleId: string): Promise<RuleState> {
    const cached = this.ruleStates.get(vehicleId);
    if (cached) return cached;
    const rows = await this.db.select().from(appSettings).where(eq(appSettings.key, stateKey(vehicleId)));
    let state = emptyRuleState();
    if (rows[0]) {
      try {
        state = { ...emptyRuleState(), ...(JSON.parse(rows[0].value) as Partial<RuleState>) };
        this.savedStates.set(vehicleId, rows[0].value);
      } catch {
        // Start over from a fresh baseline.
      }
    }
    this.ruleStates.set(vehicleId, state);
    return state;
  }

  private async persist(vehicleId: string, state: RuleState): Promise<void> {
    const value = JSON.stringify(state);
    if (this.savedStates.get(vehicleId) === value) return;
    await this.db
      .insert(appSettings)
      .values({ key: stateKey(vehicleId), value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } });
    this.savedStates.set(vehicleId, value);
  }

  private resolved(): Promise<ResolvedSettings> {
    this.settings ??= this.load().catch((err: unknown) => {
      this.settings = undefined;
      throw err;
    });
    return this.settings;
  }

  private async load(): Promise<ResolvedSettings> {
    const rows = await this.db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY));
    const fallback: ResolvedSettings = { enabled: false, destinations: [], appUrl: null, events: DEFAULT_EVENTS };
    if (!rows[0]) return fallback;
    try {
      const stored = storedSchema.parse(JSON.parse(rows[0].value));
      const destinations = stored.destinations.flatMap((d): Destination[] => {
        try {
          return [{ id: d.id, kind: d.kind, name: d.name, url: this.crypto.decrypt(d.urlEnc) }];
        } catch {
          // APP_SECRET changed: the URL has to be entered again.
          return [];
        }
      });
      const events = eventsSchema.parse({ ...DEFAULT_EVENTS, ...stored.events });
      return { enabled: stored.enabled, destinations, appUrl: normalizeAppUrl(stored.appUrl), events };
    } catch {
      return fallback;
    }
  }

  private homeSpots(): Promise<Spot[]> {
    if (!this.home || this.now() - this.home.at > HOME_CACHE_MS) {
      const ctx = { db: this.db };
      this.home = {
        at: this.now(),
        spots: (async () => {
          const settings = await getHomeChargingSettings(ctx);
          const boxes = await this.db
            .select({ latitude: wallboxes.latitude, longitude: wallboxes.longitude })
            .from(wallboxes);
          return homeSpots(settings, boxes);
        })(),
        pressure: getUnitPreferences(ctx).then((u) => (u.distance === "mi" ? "psi" : "bar")),
      };
    }
    return this.home.spots;
  }
}
