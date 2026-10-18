import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { parallaxTopics, stateFields, vehicles } from '../db/schema.js';

/**
 * The short keys the history tables use in place of names: each vehicle's
 * `seq`, and ids for state field names and Parallax topics. Ids are made
 * on first use and cached, so a new field or topic needs no migration.
 */
export class HistoryKeys {
  private readonly seqs = new Map<string, number>();
  private readonly fields = new Map<string, number>();
  private readonly topics = new Map<string, number>();

  constructor(private readonly db: Db) {}

  /** The vehicle's seq, or null for a vehicle that isn't stored. */
  async vehicleSeq(vehicleId: string): Promise<number | null> {
    const cached = this.seqs.get(vehicleId);
    if (cached !== undefined) return cached;
    const [row] = await this.db
      .select({ seq: vehicles.seq })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId));
    if (row) this.seqs.set(vehicleId, row.seq);
    return row?.seq ?? null;
  }

  /** Ids for state field names, made for the ones that have none yet. */
  fieldIds(names: readonly string[]): Promise<Map<string, number>> {
    return this.ids(this.fields, names, async (missing) => {
      await this.db
        .insert(stateFields)
        .values(missing.map((name) => ({ name })))
        .onConflictDoNothing();
      return this.db
        .select({ id: stateFields.id, name: stateFields.name })
        .from(stateFields)
        .where(inArray(stateFields.name, missing));
    });
  }

  /** Ids for Parallax topics, made for the ones that have none yet (unless `create` is false). */
  topicIds(rvms: readonly string[], create = true): Promise<Map<string, number>> {
    return this.ids(this.topics, rvms, async (missing) => {
      if (create) {
        await this.db
          .insert(parallaxTopics)
          .values(missing.map((rvm) => ({ rvm })))
          .onConflictDoNothing();
      }
      return this.db
        .select({ id: parallaxTopics.id, name: sql<string>`${parallaxTopics.rvm}` })
        .from(parallaxTopics)
        .where(inArray(parallaxTopics.rvm, missing));
    });
  }

  private async ids(
    cache: Map<string, number>,
    names: readonly string[],
    load: (missing: string[]) => Promise<{ id: number; name: string }[]>,
  ): Promise<Map<string, number>> {
    const missing = [...new Set(names)].filter((n) => !cache.has(n));
    if (missing.length > 0) {
      for (const row of await load(missing)) cache.set(row.name, row.id);
    }
    return new Map(names.flatMap((n) => (cache.has(n) ? [[n, cache.get(n)!] as const] : [])));
  }
}
