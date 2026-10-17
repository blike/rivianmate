import { pino, stdSerializers, type Logger } from 'pino';
import pretty from 'pino-pretty';
import type { Config } from './config.js';
import { describeRivianError } from './rivian/types.js';

export type { Logger };

/** For tests and optional dependencies: drops everything. */
export const silentLogger: Logger = pino({ level: 'silent' });

// A safety net: nothing should log these, but if an object carrying them is
// logged anyway, they never reach disk. Matched at the top level and up to two
// objects deep, since a redact path doesn't match at any depth.
const SECRET_KEYS = [
  'password',
  'email',
  'token',
  'userSessionToken',
  'accessToken',
  'refreshToken',
  'appSessionToken',
  'latitude',
  'longitude',
];
const REDACT = [
  'req.headers.cookie',
  ...SECRET_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
];

/**
 * Rivian errors carry the whole response, which can hold tokens and
 * locations; keep only its GraphQL errors.
 */
function serializeError(err: unknown) {
  if (!(err instanceof Error)) return err;
  const { response: _response, ...rest } = stdSerializers.err(err) as ReturnType<
    typeof stdSerializers.err
  > & { response?: unknown };
  const detail = describeRivianError(err);
  return detail === err.message ? rest : { ...rest, detail };
}

export function createLogger(
  config: Pick<Config, 'LOG_LEVEL' | 'LOG_FORMAT'>,
  /** Where lines go; stdout by default. */
  destination: NodeJS.WritableStream = process.stdout,
): Logger {
  const options = {
    level: config.LOG_LEVEL,
    redact: REDACT,
    serializers: { err: serializeError },
    base: undefined,
  };
  if (config.LOG_FORMAT === 'json') return pino(options, destination);
  return pino(
    options,
    pretty({
      // Synchronous, so the last line before process.exit() isn't lost.
      sync: true,
      // No timestamp: Docker adds its own to every line (docker compose logs -t).
      ignore: 'time,component',
      // Fields on the message's line; errors still get their stack below it.
      singleLine: true,
      messageFormat,
      destination,
    }),
  );
}

// "[ws] reconnecting in 2s" reads better than a trailing component field.
function messageFormat(log: Record<string, unknown>, messageKey: string): string {
  const message = String(log[messageKey] ?? '');
  return typeof log.component === 'string' ? `[${log.component}] ${message}` : message;
}
