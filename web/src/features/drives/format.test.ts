import type { DriveDto, DrivePlaceDto } from '@server/api-types';
import { describe, expect, it } from 'vitest';
import { DEFAULT_UNITS, unitFormatter } from '../../lib/units';
import { driveFacts, driveTitle } from './format';

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

  it('titles a drive navigating somewhere by where it’s headed', () => {
    expect(
      driveTitle(
        drive({
          endedAt: null,
          start: place('Work', 2),
          destination: { name: 'El Camino Creek', lat: 1, lon: 1 },
        }),
      ),
    ).toBe('Navigating to El Camino Creek');
  });
});

describe('driveFacts', () => {
  const u = unitFormatter(DEFAULT_UNITS);
  const figures = {
    startedAt: '2026-10-12T00:00:00Z',
    startBattery: 80,
    endBattery: 77,
    distanceKm: 30,
    energyKwh: 6,
  };

  it('gives duration, battery used and efficiency', () => {
    expect(driveFacts(drive(figures), u).split(' · ')).toHaveLength(3);
  });

  it('adds the outside temperature when known', () => {
    expect(
      driveFacts(drive({ ...figures, outsideTempC: 10 }), u)
        .split(' · ')
        .at(-1),
    ).toBe('50 °F');
  });

  it('leaves out efficiency until the drive ends', () => {
    const facts = driveFacts(drive({ ...figures, endedAt: null }), u);
    expect(facts).not.toContain('kWh');
    expect(facts.split(' · ')).toHaveLength(2);
  });
});
