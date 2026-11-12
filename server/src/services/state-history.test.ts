import { describe, expect, it } from 'vitest';
import { StateDiff, bucketSeries, heldValues, timeline } from './state-history.js';

const t = (iso: string) => Date.parse(iso);
const HOUR = 3600_000;

describe('StateDiff', () => {
  it('keeps changes of value, not re-stamps of the same one', () => {
    const diff = new StateDiff();
    const at = (s: string) => ({ value: 'park', timeStamp: s });
    expect(diff.changes({ gearStatus: at('2026-10-01T10:00:00Z') }, 0)).toHaveLength(1);
    expect(diff.changes({ gearStatus: at('2026-10-01T10:05:00Z') }, 0)).toHaveLength(0);
    expect(
      diff.changes({ gearStatus: { value: 'drive', timeStamp: '2026-10-01T10:06:00Z' } }, 0),
    ).toEqual([{ field: 'gearStatus', at: t('2026-10-01T10:06:00Z'), value: 'drive' }]);
  });

  it("records capacity once it's moved 0.1 kWh from the last recorded value", () => {
    const diff = new StateDiff();
    const capacity = (value: number) => ({
      batteryCapacity: { value, timeStamp: '2026-10-01T10:00:00Z' },
    });
    const recorded = [111.44, 111.46, 111.49, 111.54, 111.55].filter(
      (v) => diff.changes(capacity(v), 0).length > 0,
    );
    // Slow drift still shows: 111.54 is 0.1 from 111.44.
    expect(recorded).toEqual([111.44, 111.54]);
  });

  it('ignores tire pressure bouncing between the feeds, keeping 0.01 bar steps', () => {
    const diff = new StateDiff();
    const pressure = (value: number) => ({
      tirePressureRearLeft: { value, timeStamp: '2026-10-01T10:00:00Z' },
    });
    const recorded = [3.03, 3.025, 3.03, 3.025, 3.04, 3.05, 3.045, 3.025].filter(
      (v) => diff.changes(pressure(v), 0).length > 0,
    );
    expect(recorded).toEqual([3.03, 3.04, 3.05, 3.025]);
  });

  it('records a cell temperature once it has moved 0.5 °C from the last recorded one', () => {
    for (const field of ['batteryTempAvg', 'batteryTempMax', 'batteryTempMin']) {
      const diff = new StateDiff();
      const temp = (value: number) => ({ [field]: { value, timeStamp: '2026-10-01T10:00:00Z' } });
      // 0.2 °C is under the band, on a grid where a 0.1 band would filter nothing; 0.6 is a change.
      const recorded = [21.0, 21.2, 21.6].filter((v) => diff.changes(temp(v), 0).length > 0);
      expect(recorded, field).toEqual([21.0, 21.6]);
    }
  });

  it('records all three cell temperatures when one of them moves', () => {
    const diff = new StateDiff();
    const frame = (avg: number, max: number, min: number, ts: string) => ({
      batteryTempAvg: { value: avg, timeStamp: ts },
      batteryTempMax: { value: max, timeStamp: ts },
      batteryTempMin: { value: min, timeStamp: ts },
    });
    expect(diff.changes(frame(22, 24, 20, '2026-10-01T10:00:00Z'), 0)).toHaveLength(3);

    // Only the hottest cell moved far enough on its own. The frame is still one
    // reading of the pack, so all three are recorded from it and the average
    // cannot be left behind saying 22 while the hottest cell says 24.6.
    expect(
      diff
        .changes(frame(22.2, 24.6, 20.1, '2026-10-01T10:00:12Z'), 0)
        .map((c) => [c.field, c.value]),
    ).toEqual([
      ['batteryTempAvg', 22.2],
      ['batteryTempMax', 24.6],
      ['batteryTempMin', 20.1],
    ]);

    // None of them far enough from the frame just recorded: nothing to write.
    expect(diff.changes(frame(22.3, 24.7, 20.2, '2026-10-01T10:00:24Z'), 0)).toEqual([]);
  });

  it('leaves out GPS and the cloud connection, and uses the fallback time without a stamp', () => {
    const diff = new StateDiff();
    const changes = diff.changes(
      {
        gnssLocation: { latitude: 33, longitude: -117, timeStamp: '2026-10-01T10:00:00Z' },
        navLocation: { latitude: 33, longitude: -117, timeStamp: '2026-10-01T10:00:02Z' },
        gnssSpeed: { value: 20, timeStamp: '2026-10-01T10:00:00Z' },
        cloudConnection: { lastSync: '2026-10-01T10:00:00Z', isOnline: true },
        batteryLevel: { value: 80, timeStamp: 'not a time' },
      },
      t('2026-10-01T11:00:00Z'),
    );
    expect(changes).toEqual([{ field: 'batteryLevel', at: t('2026-10-01T11:00:00Z'), value: 80 }]);
  });
});

describe('heldValues', () => {
  const from = t('2026-10-01T10:00:00Z');

  it('widens the band to reach around its average', () => {
    // Rows written one field at a time: the hottest cell was recorded cooling
    // before the average moved, so the two disagree. No pack reads with an
    // average hotter than its hottest cell, so the band is stretched to it.
    const rows = heldValues({
      avg: [
        { at: from, value: 20 },
        { at: from + 2 * HOUR, value: 22 },
      ],
      max: [
        { at: from, value: 24 },
        { at: from + HOUR, value: 21 },
      ],
      min: [{ at: from, value: 19 }],
    });
    expect(rows.map((r) => [r.avg, r.min, r.max])).toEqual([
      [20, 19, 24],
      [20, 19, 21],
      [22, 19, 22],
    ]);
  });

  it('widens the coldest cell to the average when the average falls below it', () => {
    const rows = heldValues({
      avg: [{ at: from, value: 20 }],
      max: [{ at: from, value: 24 }],
      min: [
        { at: from, value: 18 },
        { at: from + HOUR, value: 21 },
      ],
    });
    expect(rows.map((r) => [r.avg, r.min, r.max])).toEqual([
      [20, 18, 24],
      [20, 20, 24],
    ]);
  });

  it('leaves a field the vehicle never reported empty', () => {
    const rows = heldValues({ avg: [{ at: from, value: 20 }], min: [], max: [] });
    expect(rows).toEqual([{ at: from, avg: 20, min: null, max: null }]);
  });
});

describe('timeline', () => {
  it('carries each value forward, with an entry at every change and heartbeat', () => {
    const from = t('2026-10-01T10:00:00Z');
    const entries = timeline(
      [{ field: 'batteryLevel', at: t('2026-10-01T09:00:00Z'), value: 80 }],
      [
        { field: 'gearStatus', at: t('2026-10-01T10:10:00Z'), value: 'drive' },
        { field: 'batteryLevel', at: t('2026-10-01T10:20:00Z'), value: 79 },
      ],
      [t('2026-10-01T10:15:00Z')],
      from,
    );
    expect(entries.map((e) => [e.at, e.state.batteryLevel, e.state.gearStatus])).toEqual([
      [from, { value: 80, timeStamp: '2026-10-01T09:00:00.000Z' }, undefined],
      [
        t('2026-10-01T10:10:00Z'),
        { value: 80, timeStamp: '2026-10-01T09:00:00.000Z' },
        { value: 'drive', timeStamp: '2026-10-01T10:10:00.000Z' },
      ],
      [
        t('2026-10-01T10:15:00Z'),
        { value: 80, timeStamp: '2026-10-01T09:00:00.000Z' },
        { value: 'drive', timeStamp: '2026-10-01T10:10:00.000Z' },
      ],
      [
        t('2026-10-01T10:20:00Z'),
        { value: 79, timeStamp: '2026-10-01T10:20:00.000Z' },
        { value: 'drive', timeStamp: '2026-10-01T10:10:00.000Z' },
      ],
    ]);
  });

  it('starts at the first change when nothing was known before', () => {
    const entries = timeline(
      [],
      [{ field: 'batteryLevel', at: t('2026-10-01T10:20:00Z'), value: 79 }],
      [t('2026-10-01T10:05:00Z')],
      t('2026-10-01T10:00:00Z'),
    );
    expect(entries.map((e) => e.at)).toEqual([t('2026-10-01T10:20:00Z')]);
  });
});

describe('bucketSeries', () => {
  const from = t('2026-10-01T10:00:00Z');

  it("weights each bucket's average by how long each value held", () => {
    const buckets = bucketSeries(
      { at: t('2026-10-01T08:00:00Z'), value: 80 },
      [{ at: t('2026-10-01T10:15:00Z'), value: 70 }],
      from,
      from + 2 * HOUR,
      HOUR,
    );
    expect(buckets).toEqual([
      { bucket: from, avg: 72.5, min: 70, max: 80 },
      { bucket: from + HOUR, avg: 70, min: 70, max: 70 },
    ]);
  });

  it('leaves out buckets before the first known value', () => {
    const buckets = bucketSeries(
      null,
      [{ at: t('2026-10-01T11:30:00Z'), value: 50 }],
      from,
      from + 3 * HOUR,
      HOUR,
    );
    expect(buckets.map((b) => [b.bucket, b.avg])).toEqual([
      [from + HOUR, 50],
      [from + 2 * HOUR, 50],
    ]);
  });

  it('aligns buckets to whole intervals, as date_bin does', () => {
    const buckets = bucketSeries(
      { at: from, value: 1 },
      [],
      from + 20 * 60_000,
      from + 2 * HOUR,
      HOUR,
    );
    expect(buckets.map((b) => b.bucket)).toEqual([from, from + HOUR]);
  });
});
