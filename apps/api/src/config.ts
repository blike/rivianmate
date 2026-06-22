import "dotenv/config";

import { z } from "zod";

const configSchema = z.object({
  APP_PORT: z.coerce.number().int().positive().default(4000),
  APP_SECRET: z.string().min(32).default("replace-with-at-least-32-random-characters"),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://rivianmate:rivianmate@localhost:5432/rivianmate"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WEB_DIST_DIR: z.string().optional(),
  WEB_ORIGIN: z.string().default("http://localhost:5173")
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(): AppConfig {
  return configSchema.parse(process.env);
}
