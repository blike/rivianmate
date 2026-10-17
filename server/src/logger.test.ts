import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';
import { RivianApiError } from './rivian/types.js';

function capture(format: 'json' | 'pretty') {
  const lines: string[] = [];
  const out = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(...chunk.toString().split('\n').filter(Boolean));
      done();
    },
  });
  return { log: createLogger({ LOG_LEVEL: 'info', LOG_FORMAT: format }, out), lines };
}

describe('logger', () => {
  it("keeps a Rivian error's GraphQL errors but not the rest of its response", () => {
    const { log, lines } = capture('json');
    const response = {
      data: { vehicleState: { gnssLocation: { latitude: 47.6 } } },
      errors: [{ message: 'Cannot query field "foo"' }],
    };
    log.warn(
      { err: new RivianApiError('bad request', 'BAD_USER_INPUT', undefined, 400, response) },
      'x',
    );
    const entry = JSON.parse(lines[0]!) as { err: Record<string, unknown> };
    expect(entry.err.response).toBeUndefined();
    expect(entry.err.detail).toContain('Cannot query field');
    expect(entry.err.stack).toBeDefined();
    expect(lines[0]).not.toContain('47.6');
  });

  it('redacts credentials and coordinates', () => {
    const { log, lines } = capture('json');
    log.info({ user: { email: 'a@b.c', password: 'hunter2' }, at: { latitude: 47.6 } }, 'x');
    expect(lines[0]).not.toMatch(/a@b\.c|hunter2|47\.6/);
  });

  it('redacts at the top level and two objects deep', () => {
    const { log, lines } = capture('json');
    log.info({ email: 'a@b.c', accessToken: 'secret-token' }, 'x');
    log.info({ state: { gnssLocation: { latitude: 47.6, longitude: -122.3 } } }, 'x');
    expect(lines.join('\n')).not.toMatch(/a@b\.c|secret-token|47\.6|122\.3/);
  });

  it('prefixes pretty lines with the component and drops debug by default', () => {
    const { log, lines } = capture('pretty');
    const ws = log.child({ component: 'ws' });
    ws.debug('reconnecting in 2s');
    ws.warn('connection dropped');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[ws] connection dropped');
  });
});
