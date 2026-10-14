import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChargingWindow } from '../rivian/parallax/index.js';
import type { ChargingSchedule } from '../rivian/types.js';
import { ChargingScheduleRefresh, includesWindow } from './schedule-refresh.js';

/** Wednesday 00:00–06:00 at 32 A, as Parallax sent it. */
const window = (amps = 32, endMinute = 360): ChargingWindow => ({
  startDay: 4,
  startMinute: 0,
  endDay: 4,
  endMinute,
  amps,
  latitude: 33.07,
  longitude: -117.26,
});
const weekdays: ChargingSchedule = {
  enabled: true,
  startTime: 0,
  duration: 360,
  amperage: 32,
  weekDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  location: null,
};

describe('includesWindow', () => {
  it('finds the window in a schedule for its day, with the same times and current', () => {
    expect(includesWindow([weekdays], window())).toBe(true);
    expect(includesWindow([weekdays], window(30))).toBe(false);
    expect(includesWindow([weekdays], window(32, 300))).toBe(false);
    expect(includesWindow([{ ...weekdays, weekDays: ['Saturday'] }], window())).toBe(false);
    expect(includesWindow([{ ...weekdays, enabled: false }], window())).toBe(false);
    expect(includesWindow([], window())).toBe(false);
  });
});

describe('ChargingScheduleRefresh', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('queries once a run of window changes has settled', async () => {
    const fetch = vi.fn(async () => [weekdays]);
    const refresh = new ChargingScheduleRefresh(fetch);
    refresh.noteWindow('v1', window(30));
    await vi.advanceTimersByTimeAsync(10_000);
    refresh.noteWindow('v1', window());
    await vi.advanceTimersByTimeAsync(29_000);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('ignores a window it has already seen, and an empty one', async () => {
    const fetch = vi.fn(async () => [weekdays]);
    const refresh = new ChargingScheduleRefresh(fetch);
    refresh.noteWindow('v1', window());
    await vi.advanceTimersByTimeAsync(30_000);
    refresh.noteWindow('v1', window());
    refresh.noteWindow('v1', null);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('asks again until the query has the window, a few times at most', async () => {
    const answers: (ChargingSchedule[] | null)[] = [[], null, [weekdays]];
    const fetch = vi.fn(async () => answers.shift() ?? []);
    const refresh = new ChargingScheduleRefresh(fetch);
    refresh.noteWindow('v1', window());
    await vi.advanceTimersByTimeAsync(30_000 + 2 * 120_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(fetch).toHaveBeenCalledTimes(3);

    // Never there (an R2 whose query returns nothing): the first try and 3 more.
    const never = vi.fn(async () => []);
    new ChargingScheduleRefresh(never).noteWindow('v2', window());
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(never).toHaveBeenCalledTimes(4);
  });

  it('cancels pending queries when stopped', async () => {
    const fetch = vi.fn(async () => [weekdays]);
    const refresh = new ChargingScheduleRefresh(fetch);
    refresh.noteWindow('v1', window());
    refresh.stop();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(fetch).not.toHaveBeenCalled();
  });
});
