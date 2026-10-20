import { describe, expect, it } from 'vitest';
import { LoginThrottle } from './login-throttle.js';

describe('LoginThrottle', () => {
  it('holds an address back after too many failures until they age out', () => {
    let now = 0;
    const throttle = new LoginThrottle(() => now, 3, 60_000);
    for (let i = 0; i < 3; i++) {
      expect(throttle.retryAfter('a')).toBe(0);
      throttle.fail('a');
      now += 1_000;
    }
    // The first failure was at 0, so the window frees up at 60s.
    expect(throttle.retryAfter('a')).toBe(57);
    expect(throttle.retryAfter('b')).toBe(0);
    now = 60_001;
    expect(throttle.retryAfter('a')).toBe(0);
  });

  it('forgets failures after a success', () => {
    const throttle = new LoginThrottle(() => 0, 2, 60_000);
    throttle.fail('a');
    throttle.succeed('a');
    throttle.fail('a');
    expect(throttle.retryAfter('a')).toBe(0);
  });
});
