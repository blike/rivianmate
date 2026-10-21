import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { LookupSettings, UnitPreferences, VersionResponse } from '../api-types.js';
import type { AppContext } from '../context.js';
import { appSettings } from '../db/schema.js';
import { type ChargingSettings, DEFAULT_CHARGING } from '../services/locations.js';
import { loadVersion } from '../version.js';

const UNITS_KEY = 'display_units';
const HOME_CHARGING_KEY = 'home_charging';
const LOOKUPS_KEY = 'outside_lookups';
/** Set at first-run setup until the lookups are chosen; both stay off meanwhile. */
const LOOKUPS_PENDING_KEY = 'outside_lookups_pending';

/** Earlier versions kept the home location and rate here too; they're ignored now. */
const chargingSchema = z.object({ currency: z.string().regex(/^[A-Z]{3}$/) });

/** Settings readers log unreadable stored values when given a logger. */
type SettingsContext = Pick<AppContext, 'db'> & Partial<Pick<AppContext, 'log'>>;

async function readHomeCharging(ctx: SettingsContext): Promise<Record<string, unknown>> {
  const rows = await ctx.db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, HOME_CHARGING_KEY));
  try {
    return rows[0] ? (JSON.parse(rows[0].value) as Record<string, unknown>) : {};
  } catch (err) {
    ctx.log?.warn({ err }, 'stored charging settings are unreadable; using defaults');
    return {};
  }
}

export async function getChargingSettings(ctx: SettingsContext): Promise<ChargingSettings> {
  const parsed = chargingSchema.safeParse(await readHomeCharging(ctx));
  return parsed.success ? parsed.data : DEFAULT_CHARGING;
}

export const DEFAULT_UNITS: UnitPreferences = { distance: 'mi', temperature: 'F' };

const unitsSchema = z.object({
  distance: z.enum(['mi', 'km']),
  temperature: z.enum(['F', 'C']),
});

export async function getUnitPreferences(ctx: SettingsContext): Promise<UnitPreferences> {
  const rows = await ctx.db.select().from(appSettings).where(eq(appSettings.key, UNITS_KEY));
  if (!rows[0]) return DEFAULT_UNITS;
  try {
    return unitsSchema.parse(JSON.parse(rows[0].value));
  } catch (err) {
    ctx.log?.warn({ err }, 'stored unit preferences are unreadable; using defaults');
    return DEFAULT_UNITS;
  }
}

/** Both on until turned off, as before there was a setting. */
export const DEFAULT_LOOKUPS: LookupSettings = { addresses: true, weather: true };

export const lookupsSchema = z.object({ addresses: z.boolean(), weather: z.boolean() });

export async function getLookupSettings(ctx: SettingsContext): Promise<LookupSettings> {
  const rows = await ctx.db.select().from(appSettings).where(eq(appSettings.key, LOOKUPS_KEY));
  if (!rows[0]) return DEFAULT_LOOKUPS;
  try {
    return lookupsSchema.parse(JSON.parse(rows[0].value));
  } catch (err) {
    ctx.log?.warn({ err }, 'stored lookup settings are unreadable; using defaults');
    return DEFAULT_LOOKUPS;
  }
}

/** Stores the lookup settings, which settles the choice asked for at setup, and applies them. */
export async function saveLookupSettings(
  ctx: Pick<AppContext, 'db' | 'monitor'>,
  lookups: LookupSettings,
): Promise<void> {
  const value = JSON.stringify(lookups);
  await ctx.db.transaction(async (tx) => {
    await tx
      .insert(appSettings)
      .values({ key: LOOKUPS_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } });
    await tx.delete(appSettings).where(eq(appSettings.key, LOOKUPS_PENDING_KEY));
  });
  ctx.monitor.setLookups(lookups);
}

/**
 * At first-run setup: hold both lookups off until they're chosen, after the
 * Rivian account is connected, so none runs before then.
 */
export async function holdLookupsForChoice(ctx: Pick<AppContext, 'db' | 'monitor'>) {
  const off: LookupSettings = { addresses: false, weather: false };
  const value = JSON.stringify(off);
  await ctx.db
    .insert(appSettings)
    .values([
      { key: LOOKUPS_KEY, value },
      { key: LOOKUPS_PENDING_KEY, value: 'true' },
    ])
    .onConflictDoNothing();
  ctx.monitor.setLookups(off);
}

/** Whether setup is still waiting for the lookups to be chosen. */
export async function lookupChoicePending(ctx: Pick<AppContext, 'db'>): Promise<boolean> {
  const rows = await ctx.db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, LOOKUPS_PENDING_KEY));
  return rows.length > 0;
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

  app.get('/api/settings/lookups', async (): Promise<LookupSettings> => getLookupSettings(ctx));

  app.put('/api/settings/lookups', async (request): Promise<LookupSettings> => {
    const lookups = lookupsSchema.parse(request.body);
    await saveLookupSettings(ctx, lookups);
    return lookups;
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
