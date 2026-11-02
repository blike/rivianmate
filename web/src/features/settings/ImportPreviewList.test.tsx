import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ImportChargePreview, ImportDrivePreview, ImportPreviewDto } from '../../api/client';
import {
  ChargeRow,
  ImportPreviewList,
  duration,
  groupByMonth,
  timeSpan,
} from './ImportPreviewList';

const drive: ImportDrivePreview = {
  startedAt: '2026-10-30T19:53:07Z',
  endedAt: '2026-10-30T20:04:07Z',
  status: 'new',
  distanceKm: 5.857,
  startBattery: 58.2,
  endBattery: 57.2,
  startPlace: 'Home',
  endPlace: null,
};

const preview = (p: Partial<ImportPreviewDto>): ImportPreviewDto => ({
  firstDate: '2026-10-30',
  lastDate: '2026-10-30',
  rows: 10,
  unreadableRows: 0,
  drivesNew: 0,
  drivesRecorded: 0,
  drivesNewer: 0,
  sessionsNew: 0,
  sessionsEnriched: 0,
  readingsNew: 0,
  readingsRecorded: 0,
  warnings: [],
  drives: [],
  charges: [],
  ...p,
});

const render = (p: Partial<ImportPreviewDto>) => {
  const client = new QueryClient();
  client.setQueryData(['units'], { distance: 'mi', temperature: 'F' });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ImportPreviewList preview={preview(p)} timeZone="America/Los_Angeles" />
    </QueryClientProvider>,
  );
};

describe('ImportPreviewList', () => {
  it('shows a drive with its time in the chosen zone, place, distance and levels', () => {
    const html = render({ drives: [drive] });
    expect(html).toMatch(/12:53.*1:04/);
    expect(html).not.toContain('Home');
    expect(html).not.toContain('?');
    expect(render({ drives: [{ ...drive, endPlace: 'Work' }] })).toContain('Home → Work');
    expect(html).toContain('3.6 mi');
    expect(html).toContain('11 min');
    expect(html).toContain('58% → 57%');
    expect(html).toContain('Will import');
  });

  it('counts both kinds and says why one is skipped', () => {
    const html = render({ drives: [{ ...drive, status: 'recorded' }] });
    expect(html).toContain('Drives (1)');
    expect(html).toContain('Charges (0)');
    expect(html).toContain('Already recorded');
  });

  it('keeps a thousand drives short: months closed but the newest, with their totals', () => {
    const drives = Array.from({ length: 1000 }, (_, i) => ({
      ...drive,
      startedAt: new Date(Date.UTC(2023, 0, 1) + i * 86_400_000).toISOString(),
      endedAt: new Date(Date.UTC(2023, 0, 1) + i * 86_400_000 + 600_000).toISOString(),
    }));
    const html = render({ drives });
    expect(html).toContain('Drives (1,000)');
    expect(html.match(/<details/g)!.length).toBeGreaterThan(30);
    expect(html.match(/<details open/g)).toHaveLength(1);
    expect(html.indexOf('September 2025')).toBeLessThan(html.indexOf('August 2025'));
    expect(html).toMatch(/30 to import · 109 mi/);
  });

  it('opens every month when the list is short', () => {
    const html = render({
      drives: [
        drive,
        { ...drive, startedAt: '2026-09-01T19:00:00Z', endedAt: '2026-09-01T19:10:00Z' },
      ],
    });
    expect(html.match(/<details open/g)).toHaveLength(2);
  });

  it('counts what is skipped in a month, leaving it out of the total', () => {
    const html = render({
      drives: [drive, { ...drive, status: 'recorded', startedAt: '2026-10-01T19:00:00Z' }],
    });
    expect(html).toContain('1 to import · 4 mi');
    expect(html).toContain('1 skipped');
  });

  it('on a charge you already have, shows only what would change', () => {
    const charge: ImportChargePreview = {
      startedAt: '2026-10-29T15:02:08Z',
      endedAt: '2026-10-29T22:40:07Z',
      status: 'enrich',
      adds: ['chargingTime', 'batteryLevels', 'curve'],
      chargingSeconds: 27_479,
      startSoc: 46.6,
      endSoc: 77.3,
      energyKwh: 42.5,
      maxPowerKw: 6.1,
      place: null,
    };
    const client = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ChargeRow charge={charge} timeZone="UTC" />
      </QueryClientProvider>,
    );
    expect(html).toContain('7 h 38 min');
    expect(html).toContain('47% → 77%');
    expect(html).toContain('Charging time, battery levels, charging curve');
    expect(html).not.toContain('42.5');
    expect(html).not.toContain('6.1');
  });

  it('says so when there is nothing in the dates', () => {
    expect(render({})).toContain('No drives in these dates.');
  });
});

describe('groupByMonth', () => {
  const at = (startedAt: string) => ({ ...drive, startedAt, endedAt: startedAt });

  it('uses the month in the chosen zone', () => {
    // Nov 1 in UTC, still Oct 31 in Los Angeles.
    const groups = groupByMonth([at('2026-11-01T02:00:00Z')], 'America/Los_Angeles');
    expect(groups[0]!.key).toBe('2026-10');
  });

  it('goes newest first, in months and within them', () => {
    const groups = groupByMonth(
      [at('2026-09-02T12:00:00Z'), at('2026-10-01T12:00:00Z'), at('2026-10-02T12:00:00Z')],
      'UTC',
    );
    expect(groups.map((g) => g.key)).toEqual(['2026-10', '2026-09']);
    expect(groups[0]!.items[0]!.startedAt).toBe('2026-10-02T12:00:00Z');
  });
});

describe('duration', () => {
  it('reads as minutes, then hours', () => {
    expect(duration(660)).toBe('11 min');
    expect(duration(27_479)).toBe('7 h 38 min');
  });
});

describe('timeSpan', () => {
  it('gives the date once when a span stays within a day', () => {
    const text = timeSpan(drive.startedAt, drive.endedAt, 'America/Los_Angeles');
    expect(text.match(/Oct/g)).toHaveLength(1);
  });

  it('gives both dates, in the chosen zone, when it crosses midnight', () => {
    const text = timeSpan('2026-10-31T06:00:00Z', '2026-10-31T08:00:00Z', 'America/Los_Angeles');
    expect(text).toContain('Oct 30');
    expect(text).toContain('Oct 31');
  });
});
