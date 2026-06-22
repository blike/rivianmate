import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export * from "./derivation.js";
export * from "./migrate.js";
export * from "./schema.js";

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 10,
    prepare: false
  });

  return {
    client,
    db: drizzle(client, { schema })
  };
}
