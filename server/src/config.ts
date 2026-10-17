import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgres://rivianmate:rivianmate@localhost:5432/rivianmate'),
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters'),
  PORT: z.coerce.number().int().default(4000),
  MOCK_RIVIAN: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  /** With MOCK_RIVIAN, a demo scene to start in (see MockScene). */
  MOCK_SCENE: z.enum(['drive-home']).optional(),
  APP_PASSWORD: z.string().optional(),
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** pretty: readable lines for `docker logs`; json: one object per line for log collectors. */
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
});

export type Config = z.infer<typeof envSchema> & {
  /** Built web app to serve, found next to the server at boot (not an env var). */
  WEB_DIST?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
