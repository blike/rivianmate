import { describe, expect, it } from 'vitest';
import { parseArgs } from './cell-temp-backfill-args.js';

describe('backfill arguments', () => {
  it('reads every option', () => {
    expect(
      parseArgs([
        '--vehicle',
        'v1',
        '--from',
        '2026-10-01T00:00:00Z',
        '--to',
        '2026-10-02T00:00:00Z',
        '--batch-hours',
        '3',
        '--dry-run',
        '--reset',
      ]),
    ).toEqual({
      vehicleId: 'v1',
      from: new Date('2026-10-01T00:00:00Z'),
      to: new Date('2026-10-02T00:00:00Z'),
      batchHours: 3,
      dryRun: true,
      reset: true,
    });
    expect(parseArgs([])).toEqual({});
  });

  it('rejects a date it cannot parse, rather than running over nothing', () => {
    // An Invalid Date makes every comparison false, so the job would exit 0 having done nothing.
    expect(() => parseArgs(['--from', 'yesterday-ish'])).toThrow('--from is not a date');
    expect(() => parseArgs(['--to', '2026-13-40'])).toThrow('--to is not a date');
  });

  it('rejects a window that is not a whole number of hours', () => {
    expect(() => parseArgs(['--batch-hours', 'abc'])).toThrow('whole number of hours');
    expect(() => parseArgs(['--batch-hours', '0'])).toThrow('whole number of hours');
    expect(() => parseArgs(['--batch-hours', '1.5'])).toThrow('whole number of hours');
  });

  it('rejects an empty range and an unknown option', () => {
    expect(() =>
      parseArgs(['--from', '2026-10-02T00:00:00Z', '--to', '2026-10-01T00:00:00Z']),
    ).toThrow('--from must be before --to');
    expect(() => parseArgs(['--nope'])).toThrow('unknown argument --nope');
    expect(() => parseArgs(['--vehicle'])).toThrow('--vehicle needs a value');
  });
});
