import type { LogEntryDto, LogLevelName } from './api-types.js';

const LEVELS: Record<number, LogLevelName> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

/** Fields every line has; the rest are shown as the line's details. */
const OWN_FIELDS = new Set(['level', 'time', 'msg', 'component']);

/**
 * The most recent log lines since startup, for the web UI. A second
 * destination next to stdout: it gets the same lines, already redacted.
 */
export class LogBuffer {
  private entries: LogEntryDto[] = [];
  private seq = 0;
  private listeners = new Set<(entry: LogEntryDto) => void>();

  constructor(private readonly capacity = 2000) {}

  /** A pino destination: one JSON line per call. */
  write(line: string): void {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!OWN_FIELDS.has(key)) fields[key] = value;
    }
    const entry: LogEntryDto = {
      seq: ++this.seq,
      time: typeof raw.time === 'number' ? new Date(raw.time).toISOString() : '',
      level: LEVELS[raw.level as number] ?? 'info',
      component: typeof raw.component === 'string' ? raw.component : null,
      msg: typeof raw.msg === 'string' ? raw.msg : '',
      ...(Object.keys(fields).length ? { fields } : {}),
    };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();
    // Listeners must not log: that would write back into this buffer.
    for (const listener of this.listeners) listener(entry);
  }

  recent(): LogEntryDto[] {
    return [...this.entries];
  }

  onEntry(listener: (entry: LogEntryDto) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
