import type { DriveDto, DrivePlaceDto } from '@server/api-types';
import { describe, expect, it } from 'vitest';
import { driveTitle } from './format';

const place = (label: string, locationId: number | null = null): DrivePlaceDto => ({
  label,
  address: null,
  isHome: false,
  locationId,
});
const drive = (over: Partial<DriveDto>) =>
  ({
    endedAt: '2026-10-12T01:00:00Z',
    start: null,
    end: null,
    destination: null,
    ...over,
  }) as DriveDto;

describe('driveTitle', () => {
  it('uses saved location names as given and shortens addresses', () => {
    expect(driveTitle(drive({ start: place('Home', 1), end: place('Work, Building 2', 2) }))).toBe(
      'Home → Work, Building 2',
    );
    expect(
      driveTitle(drive({ start: place('Work', 2), end: place('2101 Ireland Grove Road, Normal') })),
    ).toBe('Work → 2101 Ireland Grove Road');
  });

  it('titles a drive under way with no destination by where it started', () => {
    expect(driveTitle(drive({ endedAt: null, start: place('Work', 2) }))).toBe('From Work');
  });
});
