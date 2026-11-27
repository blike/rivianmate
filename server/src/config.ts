import { isIP } from 'node:net';
import { z } from 'zod';

const POSITIVE_INT_PATTERN = /^[1-9]\d*$/;

function isValidIpOrCidr(entry: string): boolean {
  const slash = entry.indexOf('/');
  if (slash === -1) return isIP(entry) !== 0;
  const ip = entry.slice(0, slash);
  const prefixStr = entry.slice(slash + 1);
  const version = isIP(ip);
  if (version === 0 || !POSITIVE_INT_PATTERN.test(prefixStr)) return false;
  const prefix = Number(prefixStr);
  const maxPrefix = version === 4 ? 32 : 128;
  return prefix >= 1 && prefix <= maxPrefix;
}

/**
 * Parses TRUST_PROXY into Fastify's `trustProxy` value:
 * - unset / empty / "false" -> false (ignore forwarding headers)
 * - comma-separated IPv4/IPv6 addresses or CIDRs -> string[]
 *
 * Rejects booleans like "true", hop counts ("1"), named ranges ("loopback"),
 * "/0" catch-all CIDRs, and any other unrecognized value.
 */
export function parseTrustProxy(value: string | undefined): false | string[] {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'false') return false;

  const entries = trimmed.split(',').map((s) => s.trim());
  for (const entry of entries) {
    if (!entry) {
      throw new Error(
        'empty entry in comma-separated list; expected IP addresses or CIDRs (e.g. 172.18.0.0/16 or 127.0.0.1)',
      );
    }
    if (!isValidIpOrCidr(entry)) {
      throw new Error(
        `invalid entry "${entry}"; expected "false" or comma-separated IP addresses/CIDRs (e.g. 172.18.0.0/16 or 127.0.0.1)`,
      );
    }
  }
  return entries;
}

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgres://rivianmate:rivianmate@localhost:5432/rivianmate'),
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters'),
  PORT: z.coerce.number().int().default(4000),
  MOCK_RIVIAN: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  /** With MOCK_RIVIAN, a demo scene to start in (see MockScene). */
  MOCK_SCENE: z.enum(['drive-home', 'awaiting-delivery']).optional(),
  APP_PASSWORD: z.string().optional(),
  /** Reverse proxy IP(s)/CIDR(s) trusted for X-Forwarded-For / X-Forwarded-Proto. */
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((value, ctx): false | string[] => {
      try {
        return parseTrustProxy(value);
      } catch (err) {
        ctx.addIssue({
          code: 'custom',
          message: err instanceof Error ? err.message : 'invalid TRUST_PROXY value',
        });
        return z.NEVER;
      }
    }),
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
