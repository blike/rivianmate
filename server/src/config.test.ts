import { describe, expect, it } from 'vitest';
import { parseTrustProxy } from './config.js';

describe('parseTrustProxy', () => {
  it('defaults to false when unset or disabled', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('  ')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
  });

  it('parses true, hop counts, named ranges, and comma-separated CIDRs', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('loopback')).toBe('loopback');
    expect(parseTrustProxy('127.0.0.1')).toBe('127.0.0.1');
    expect(parseTrustProxy('127.0.0.1, 172.16.0.0/12')).toEqual(['127.0.0.1', '172.16.0.0/12']);
  });
});
