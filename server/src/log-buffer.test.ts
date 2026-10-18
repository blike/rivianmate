import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { LogBuffer } from './log-buffer.js';
import { createLogger } from './logger.js';

const sink = () => new Writable({ write: (_chunk, _encoding, done) => done() });

describe('LogBuffer', () => {
  it('keeps redacted lines with their component and fields', () => {
    const buffer = new LogBuffer();
    const log = createLogger({ LOG_LEVEL: 'info', LOG_FORMAT: 'pretty' }, sink(), buffer);
    log.child({ component: 'ws' }).warn({ code: 4420, email: 'a@b.c' }, 'connection dropped');
    log.debug('not recorded');
    const [entry, ...rest] = buffer.recent();
    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({
      seq: 1,
      level: 'warn',
      component: 'ws',
      msg: 'connection dropped',
      fields: { code: 4420 },
    });
    expect(JSON.stringify(entry)).not.toContain('a@b.c');
  });

  it('drops the oldest lines past its capacity and tells listeners', () => {
    const buffer = new LogBuffer(2);
    const seen: number[] = [];
    buffer.onEntry((entry) => seen.push(entry.seq));
    const log = createLogger({ LOG_LEVEL: 'info', LOG_FORMAT: 'json' }, sink(), buffer);
    for (const msg of ['a', 'b', 'c']) log.info(msg);
    expect(buffer.recent().map((e) => e.msg)).toEqual(['b', 'c']);
    expect(seen).toEqual([1, 2, 3]);
  });
});
