import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { UnitPreferences, VersionResponse } from "../api-types.js";
import type { AppContext } from "../context.js";
import { appSettings } from "../db/schema.js";
import { loadVersion } from "../version.js";

const UNITS_KEY = "display_units";

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
