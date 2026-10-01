import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .default("postgres://rivianmate:rivianmate@localhost:5432/rivianmate"),
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default("0.0.0.0"),
  MOCK_RIVIAN: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  /** Look up drive start/end addresses with OpenStreetMap (on unless "false"/"0"). */
  REVERSE_GEOCODING: z
    .string()
    .optional()
    .transform((v) => v !== "0" && v !== "false"),
  APP_PASSWORD: z.string().optional(),
  NODE_ENV: z.string().default("development"),
  WEB_DIST: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
