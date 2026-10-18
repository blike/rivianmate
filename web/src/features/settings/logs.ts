import type { LogEntryDto, LogLevelName } from '@server/api-types';

export type { LogEntryDto, LogLevelName };

/** As many lines as the server keeps, so a long-open tab doesn't grow forever. */
export const MAX_LINES = 2000;

const RANK: Record<LogLevelName, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** Lines at or above `level` whose text contains `query` (any case). */
export function filterLogs(
  entries: readonly LogEntryDto[],
  level: LogLevelName,
  query: string,
): LogEntryDto[] {
  const needle = query.trim().toLowerCase();
  return entries.filter(
    (e) => RANK[e.level] >= RANK[level] && (!needle || logText(e).toLowerCase().includes(needle)),
  );
}

/** Appends new lines, skipping any already held, and keeps the newest MAX_LINES. */
export function appendLogs<T extends readonly LogEntryDto[]>(
  held: T,
  incoming: readonly LogEntryDto[],
): T | LogEntryDto[] {
  const last = held.at(-1)?.seq ?? 0;
  const fresh = incoming.filter((e) => e.seq > last);
  if (!fresh.length) return held;
  const all = [...held, ...fresh];
  return all.length > MAX_LINES ? all.slice(-MAX_LINES) : all;
}

/** Everything but the error, which is shown on its own. */
export function inlineFields(entry: LogEntryDto): string {
  const { err: _err, ...rest } = entry.fields ?? {};
  return Object.entries(rest)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
}

/** The logged error's message and stack, if the line has one. */
export function errorText(entry: LogEntryDto): string | null {
  const err = entry.fields?.err as
    { message?: string; stack?: string; detail?: string } | undefined;
  if (!err) return null;
  const text = err.stack ?? err.message ?? JSON.stringify(err);
  return err.detail ? `${text}\n${err.detail}` : text;
}

/** One line as plain text, like the container's own log. */
export function logText(entry: LogEntryDto): string {
  const component = entry.component ? `[${entry.component}] ` : '';
  const fields = inlineFields(entry);
  const err = errorText(entry);
  return [
    `${entry.time} ${entry.level.toUpperCase()}: ${component}${entry.msg}${fields ? ` ${fields}` : ''}`,
    ...(err ? [err] : []),
  ].join('\n');
}
