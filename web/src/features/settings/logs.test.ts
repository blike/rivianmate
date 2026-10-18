import { describe, expect, it } from 'vitest';
import { type LogEntryDto, appendLogs, filterLogs, logText } from './logs';

const line = (seq: number, level: LogEntryDto['level'], msg: string, extra = {}): LogEntryDto => ({
  seq,
  time: '2026-10-17T12:00:00.000Z',
  level,
  component: 'ws',
  msg,
  ...extra,
});

describe('logs', () => {
  it('filters by minimum level and text', () => {
    const all = [line(1, 'debug', 'ping'), line(2, 'warn', 'dropped'), line(3, 'error', 'failed')];
    expect(filterLogs(all, 'warn', '').map((e) => e.seq)).toEqual([2, 3]);
    expect(filterLogs(all, 'debug', 'DROP').map((e) => e.seq)).toEqual([2]);
    expect(filterLogs(all, 'debug', '[ws]')).toHaveLength(3);
  });

  it('appends only lines it has not seen', () => {
    const held = [line(1, 'info', 'a'), line(2, 'info', 'b')];
    expect(
      appendLogs(held, [line(2, 'info', 'b'), line(3, 'info', 'c')]).map((e) => e.seq),
    ).toEqual([1, 2, 3]);
    expect(appendLogs(held, [line(1, 'info', 'a')])).toBe(held);
  });

  it('writes a line like the container log, with its error below', () => {
    const entry = line(1, 'error', 'failed', {
      fields: { status: 500, err: { message: 'boom', stack: 'Error: boom\n    at x' } },
    });
    expect(logText(entry)).toBe(
      '2026-10-17T12:00:00.000Z ERROR: [ws] failed status=500\nError: boom\n    at x',
    );
  });
});
