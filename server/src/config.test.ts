import { describe, expect, it } from 'vitest';
import { loadConfig, parseTrustProxy } from './config.js';

const BASE_ENV = { APP_SECRET: 'a'.repeat(32) };

describe('parseTrustProxy', () => {
  it('defaults to false when unset, blank, or false', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('   ')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('FALSE')).toBe(false);
  });

  it('parses single and comma-separated IPv4/IPv6 addresses and CIDRs', () => {
    expect(parseTrustProxy('127.0.0.1')).toEqual(['127.0.0.1']);
    expect(parseTrustProxy('::1')).toEqual(['::1']);
    expect(parseTrustProxy('172.18.0.0/16')).toEqual(['172.18.0.0/16']);
    expect(parseTrustProxy('172.18.0.1/32')).toEqual(['172.18.0.1/32']);
    expect(parseTrustProxy('fd00::/8')).toEqual(['fd00::/8']);
    expect(parseTrustProxy('::1/128')).toEqual(['::1/128']);
    expect(parseTrustProxy('127.0.0.1, ::1, 172.18.0.0/16')).toEqual([
      '127.0.0.1',
      '::1',
      '172.18.0.0/16',
    ]);
  });

  it('rejects booleans, hop counts, named ranges, /0 catch-alls, and malformed entries', () => {
    const invalid = [
      'true',
      'TRUE',
      '0',
      '1',
      '2',
      'loopback',
      'linklocal',
      'uniquelocal',
      '0.0.0.0/0',
      '::/0',
      '172.18.0.0/33',
      '172.18.0.0/08',
      '172.18.0.0/-1',
      '172.18.0.0/',
      'fd00::/129',
      '192.168.1.999',
      'not-an-ip',
      '127.0.0.1,',
      ',127.0.0.1',
      '127.0.0.1,,172.18.0.1',
    ];
    for (const value of invalid) {
      expect(() => parseTrustProxy(value), value).toThrow();
    }
  });
});

describe('loadConfig TRUST_PROXY validation', () => {
  it('loads valid TRUST_PROXY values and defaults to false', () => {
    expect(loadConfig(BASE_ENV).TRUST_PROXY).toBe(false);
    expect(loadConfig({ ...BASE_ENV, TRUST_PROXY: '172.18.0.1,192.168.1.10' }).TRUST_PROXY).toEqual(
      ['172.18.0.1', '192.168.1.10'],
    );
  });

  it('fails at startup with a clear error on invalid TRUST_PROXY values', () => {
    expect(() => loadConfig({ ...BASE_ENV, TRUST_PROXY: 'true' })).toThrow(
      /Invalid environment: TRUST_PROXY: invalid entry "true"/,
    );
    expect(() => loadConfig({ ...BASE_ENV, TRUST_PROXY: '1' })).toThrow(
      /Invalid environment: TRUST_PROXY: invalid entry "1"/,
    );
    expect(() => loadConfig({ ...BASE_ENV, TRUST_PROXY: 'loopback' })).toThrow(
      /Invalid environment: TRUST_PROXY: invalid entry "loopback"/,
    );
  });
});
