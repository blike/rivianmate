import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { UnitPreferences, VersionResponse } from "../api-types.js";
import type { AppContext } from "../context.js";
import { appSettings } from "../db/schema.js";
import {
  DEFAULT_HOME_CHARGING,
  type HomeChargingSettings,
} from "../services/home-charging.js";
import { loadVersion } from "../version.js";

const UNITS_KEY = "display_units";
const HOME_CHARGING_KEY = "home_charging";

const homeChargingSchema = z
  .object({
    ratePerKwh: z.number().min(0).max(10).nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    homeLat: z.number().min(-90).max(90).nullable(),
    homeLon: z.number().min(-180).max(180).nullable(),
  })
  .refine((s) => (s.homeLat == null) === (s.homeLon == null), {
    message: "homeLat and homeLon must be set together",
  });

export async function getHomeChargingSettings(ctx: Pick<AppContext, "db">): Promise<HomeChargingSettings> {
  const rows = await ctx.db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, HOME_CHARGING_KEY));
  if (!rows[0]) return DEFAULT_HOME_CHARGING;
  try {
    return homeChargingSchema.parse(JSON.parse(rows[0].value));
  } catch {
    return DEFAULT_HOME_CHARGING;
  }
}

export const DEFAULT_UNITS: UnitPreferences = { distance: "mi", temperature: "F" };

const unitsSchema = z.object({
  distance: z.enum(["mi", "km"]),
  temperature: z.enum(["F", "C"]),
});

export async function getUnitPreferences(ctx: AppContext): Promise<UnitPreferences> {
  const rows = await ctx.db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, UNITS_KEY));
  if (!rows[0]) return DEFAULT_UNITS;
  try {
    return unitsSchema.parse(JSON.parse(rows[0].value));
  } catch {
    return DEFAULT_UNITS;
  }
}

/** App-wide display preferences (single-user app, so stored server-side). */
export async function settingsRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  const version = loadVersion();
  app.get("/api/version", async (): Promise<VersionResponse> => version);

  app.get("/api/settings/units", async (): Promise<UnitPreferences> =>
    getUnitPreferences(ctx),
  );

  app.get("/api/settings/home-charging", async (): Promise<HomeChargingSettings> =>
    getHomeChargingSettings(ctx),
  );

  app.put("/api/settings/home-charging", async (request): Promise<HomeChargingSettings> => {
    const settings = homeChargingSchema.parse(request.body);
    const value = JSON.stringify(settings);
    await ctx.db
      .insert(appSettings)
      .values({ key: HOME_CHARGING_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } });
    return settings;
  });

  app.put("/api/settings/units", async (request): Promise<UnitPreferences> => {
    const units = unitsSchema.parse(request.body);
    const value = JSON.stringify(units);
    await ctx.db
      .insert(appSettings)
      .values({ key: UNITS_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } });
    return units;
  });
}
