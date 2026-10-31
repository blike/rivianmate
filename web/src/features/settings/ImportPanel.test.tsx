import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ImportBatchDto, ImportPreviewDto, ImportsDto, VehicleDto } from '../../api/client';
import {
  ImportPanel,
  OdometerWarning,
  PreviewRows,
  batchSummary,
  formatDay,
  importSummary,
} from './ImportPanel';

const rivian = {
  id: 'v1',
  vin: 'VIN',
  name: 'Blue',
  make: 'Rivian',
  model: 'R1S',
  modelYear: 2026,
  renders: [],
  source: 'rivian',
} as VehicleDto;
const tesla = { ...rivian, id: 'tm', name: 'Model Y', source: 'teslamate' } as VehicleDto;

const batch: ImportBatchDto = {
  id: 1,
  vehicleId: 'v1',
  files: ['a.csv'],
  timeZone: 'America/Chicago',
  from: '2026-01-01',
  to: '2026-02-01',
  status: 'done',
  counts: { drives: 2, sessions: 1, sessionsEnriched: 3, locationPoints: 50, stateChanges: 900 },
  progress: null,
  error: null,
  createdAt: '2026-02-02T00:00:00Z',
  finishedAt: '2026-02-02T00:01:00Z',
};

const render = (imports: ImportsDto, vehicles = [rivian, tesla]) => {
  const client = new QueryClient();
  client.setQueryData(['imports'], imports);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ImportPanel vehicles={vehicles} />
    </QueryClientProvider>,
  );
};

const preview: ImportPreviewDto = {
  firstDate: '2026-01-01',
  lastDate: '2026-02-01',
  rows: 1000,
  unreadableRows: 0,
  drivesNew: 2,
  drivesRecorded: 0,
  sessionsNew: 1,
  sessionsEnriched: 0,
  readingsNew: 500,
  readingsRecorded: 0,
  warnings: [],
  drivesNewer: 0,
  drives: [],
  charges: [],
};

describe('ImportPanel', () => {
  it('asks for files first', () => {
    const html = render({ draft: null, batches: [] });
    expect(html).toContain('Choose files');
    expect(html).not.toContain('Time zone');
  });

  it('offers only Rivian vehicles once files are waiting', () => {
    const html = render({ draft: { id: 'd', files: ['export.csv'] }, batches: [] });
    expect(html).toContain('export.csv');
    expect(html).toContain('Blue');
    expect(html).not.toContain('Model Y');
  });

  it('lists past imports with an undo', () => {
    const html = render({ draft: null, batches: [batch] });
    expect(html).toContain('Blue: 2026-01-01 to 2026-02-01');
    expect(html).toContain('>Undo</button>');
  });

  it('offers no undo while an import runs', () => {
    const html = render({
      draft: null,
      batches: [{ ...batch, status: 'running', counts: null, progress: 0.42 }],
    });
    expect(html).toContain('Importing… 42%');
    expect(html).not.toContain('>Undo</button>');
  });
});

describe('batchSummary', () => {
  it('says what was added and enriched', () => {
    expect(batchSummary(batch)).toBe(
      '2 drives, 1 charge, 50 location points, 900 state changes; added detail to 3 charges',
    );
  });

  it('gives a failed import its reason', () => {
    expect(batchSummary({ ...batch, status: 'failed', counts: null, error: 'Nope' })).toBe('Nope');
  });
});

describe('formatDay', () => {
  it('reads as a date, whatever the viewer’s zone', () => {
    expect(formatDay('2026-10-30')).toContain('Oct');
    expect(formatDay('2026-10-30')).toContain('30');
    expect(formatDay('2026-10-30')).toContain('2026');
  });
});

describe('importSummary', () => {
  it('says what would be added', () => {
    const summary = importSummary(preview);
    expect(summary.label).toBe('Import 2 drives and 1 charge');
    expect(summary.details).toEqual(['Also adds 500 history readings.']);
    expect(summary.canImport).toBe(true);
  });

  it('gives each thing its own short line', () => {
    expect(
      importSummary({ ...preview, sessionsEnriched: 1, readingsNew: 786, readingsRecorded: 638 })
        .details,
    ).toEqual([
      'Also adds 786 history readings and detail on 1 existing charge.',
      'Skips 638 history readings from times RivianMate was already recording.',
    ]);
  });

  it('offers no import when there is nothing to add', () => {
    const summary = importSummary({
      ...preview,
      drivesNew: 0,
      sessionsNew: 0,
      readingsNew: 0,
      readingsRecorded: 29,
    });
    expect(summary.label).toBe('Nothing new to import');
    expect(summary.canImport).toBe(false);
  });

  it('still imports when it only adds detail or history', () => {
    const none = { ...preview, drivesNew: 0, sessionsNew: 0, readingsNew: 0 };
    expect(importSummary({ ...none, sessionsEnriched: 1 }).canImport).toBe(true);
    expect(importSummary({ ...none, readingsNew: 3 }).canImport).toBe(true);
  });
});

describe('PreviewRows', () => {
  const html = (p: Partial<ImportPreviewDto>) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <PreviewRows preview={{ ...preview, ...p }} />
      </QueryClientProvider>,
    );

  it('warns about a time zone that looks wrong, leaving the car to the vehicle row', () => {
    expect(html({ warnings: ['future'] })).toContain('in the future');
    expect(html({ warnings: ['odometer'] })).not.toContain('right car');
    expect(renderToStaticMarkup(<OdometerWarning />)).toContain('right car');
    expect(html({})).not.toContain('role="alert"');
  });
});
