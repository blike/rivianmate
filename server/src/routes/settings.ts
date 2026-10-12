import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { UnitPreferences, VersionResponse } from '../api-types.js';
import type { AppContext } from '../context.js';
import { appSettings } from '../db/schema.js';
import { type ChargingSettings, DEFAULT_CHARGING } from '../services/locations.js';
import { loadVersion } from '../version.js';

const UNITS_KEY = 'display_units';
const HOME_CHARGING_KEY = 'home_charging';

/** Earlier versions kept the home location and rate here too; they're ignored now. */
const chargingSchema = z.object({ currency: z.string().regex(/^[A-Z]{3}$/) });

async function readHomeCharging(ctx: Pick<AppContext, 'db'>): Promise<Record<string, unknown>> {
  const rows = await ctx.db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, HOME_CHARGING_KEY));
  try {
    return rows[0] ? (JSON.parse(rows[0].value) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function getChargingSettings(ctx: Pick<AppContext, 'db'>): Promise<ChargingSettings> {
  const parsed = chargingSchema.safeParse(await readHomeCharging(ctx));
  return parsed.success ? parsed.data : DEFAULT_CHARGING;
}

export const DEFAULT_UNITS: UnitPreferences = { distance: 'mi', temperature: 'F' };

const unitsSchema = z.object({
  distance: z.enum(['mi', 'km']),
  temperature: z.enum(['F', 'C']),
});

export async function getUnitPreferences(ctx: Pick<AppContext, 'db'>): Promise<UnitPreferences> {
  const rows = await ctx.db.select().from(appSettings).where(eq(appSettings.key, UNITS_KEY));
  if (!rows[0]) return DEFAULT_UNITS;
  try {
    return unitsSchema.parse(JSON.parse(rows[0].value));
  } catch {
    return DEFAULT_UNITS;
  }
}

/** App-wide display preferences (single-user app, so stored server-side). */
export async function settingsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const version = loadVersion();
  app.get('/api/version', async (): Promise<VersionResponse> => version);

  app.get('/api/settings/units', async (): Promise<UnitPreferences> => getUnitPreferences(ctx));

  app.get('/api/settings/charging', async (): Promise<ChargingSettings> =>
    getChargingSettings(ctx),
  );

  app.put('/api/settings/charging', async (request): Promise<ChargingSettings> => {
    const settings = chargingSchema.parse(request.body);
    // Older fields stay, so going back to an earlier version keeps them.
    const value = JSON.stringify({ ...(await readHomeCharging(ctx)), ...settings });
    await ctx.db
      .insert(appSettings)
      .values({ key: HOME_CHARGING_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } });
    return settings;
  });

  app.put('/api/settings/units', async (request): Promise<UnitPreferences> => {
    const units = unitsSchema.parse(request.body);
    const value = JSON.stringify(units);
    await ctx.db
      .insert(appSettings)
      .values({ key: UNITS_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } });
    return units;
  });
}
