import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ImportBatchDto, ImportPreviewDto, ImportsDto, VehicleDto } from '../../api/client';
import {
  ImportFlow,
  type ImportStep,
  OdometerWarning,
  PreviewRows,
  formatDay,
  importSummary,
  reachableStep,
} from './ImportFlow';
import { ImportPanel, batchSummary } from './ImportPanel';

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
  format: 'electrafi',
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
  readingsNewer: 0,
  placesNew: [],
  placesRecorded: 0,
  warnings: [],
  drivesNewer: 0,
  drives: [],
  charges: [],
};

describe('ImportPanel', () => {
  it('says nothing about imports until they have loaded', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ImportPanel vehicles={[rivian]} />
      </QueryClientProvider>,
    );
    expect(html).toContain('Loading imports');
    expect(html).not.toContain('No imports yet');
    expect(html).not.toContain('New import');
  });

  it('starts from the list, with a way into a new import', () => {
    const html = render({ draft: null, batches: [] });
    expect(html).toContain('No imports yet');
    expect(html).toContain('>New import</button>');
    expect(html).not.toContain('Time zone');
  });

  it('needs a Rivian to import into', () => {
    const html = render({ draft: null, batches: [] }, [tesla]);
    expect(html).toMatch(/disabled=""[^>]*>New import/);
    expect(html).toContain('Connect your Rivian account');
  });

  it('offers to continue or discard a waiting upload instead of starting another', () => {
    const html = render({
      draft: { id: 'd', format: 'electrafi', files: ['export.csv'], vehicleIds: null },
      batches: [batch],
    });
    expect(html).toContain('export.csv');
    expect(html).toContain('>Continue</button>');
    expect(html).toContain('>Discard</button>');
    expect(html).toContain('>Undo</button>');
    expect(html).not.toContain('New import');
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

describe('ImportPanel while another import runs', () => {
  it('holds back undoing the others', () => {
    const html = render({
      draft: null,
      batches: [{ ...batch, id: 2, status: 'running', counts: null, progress: 0.1 }, batch],
    });
    expect(html).toMatch(/disabled=""[^>]*>Undo/);
  });
});

describe('ImportFlow', () => {
  const renderStep = (
    initialStep: ImportStep,
    draft: ImportsDto['draft'] = null,
    vehicles = [rivian],
  ) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ImportFlow
          vehicles={vehicles}
          draft={draft}
          running={false}
          initialStep={initialStep}
          onChange={() => {}}
          onExit={() => {}}
          onStarted={() => {}}
        />
      </QueryClientProvider>,
    );
  const draft = {
    id: 'd',
    format: 'electrafi' as const,
    files: ['export.csv'],
    vehicleIds: null,
  };
  const archive = { id: 'r', format: 'roamer' as const, files: ['roamer.zip'], vehicleIds: ['v1'] };

  it('starts by asking for the source, with Roamer first', () => {
    const html = renderStep('source');
    expect(html.indexOf('Roamer')).toBeGreaterThan(-1);
    expect(html.indexOf('Roamer')).toBeLessThan(html.indexOf('ElectraFi'));
    expect(html).toContain('type="radio"');
    expect(html).toContain('Step 1 of 4');
    expect(html).not.toContain('>Back</button>');
  });

  it('holds at the files step until there are some', () => {
    const html = renderStep('files');
    expect(html).toContain('Download a copy');
    expect(html).toContain('Choose file<');
    expect(html).toContain('No file added yet.');
    expect(html).not.toContain('multiple');
    expect(html).toMatch(/disabled=""[^>]*>Continue/);
    expect(html).not.toContain('Discard upload');
    const withFiles = renderStep('files', draft);
    expect(withFiles).toContain('Add your ElectraFi export');
    expect(withFiles).toContain('export.csv');
    expect(withFiles).toContain('Add more');
    expect(withFiles).not.toMatch(/disabled=""[^>]*>Continue/);
    expect(withFiles).toContain('Discard upload');
    expect(withFiles).toContain('Save for later');
  });

  it('replaces a Roamer archive rather than adding to it', () => {
    const html = renderStep('files', archive);
    expect(html).toContain('roamer.zip');
    expect(html).toContain('Choose another');
    expect(html).not.toContain('Add more');
    // The instructions stay with the file added.
    expect(html).toContain('Download a copy');
  });

  it('shows the vehicle the export was matched to, without a choice', () => {
    const red = { ...rivian, id: 'v2', name: 'Red' } as VehicleDto;
    const html = renderStep('settings', archive, [rivian, red]);
    expect(html).toContain('Blue');
    expect(html).not.toContain('Red');
    expect(html).toContain('by VIN');
    expect(html).not.toContain('id="import-vehicle"');
    const both = renderStep('settings', { ...archive, vehicleIds: ['v1', 'v2'] }, [rivian, red]);
    expect(both).toContain('id="import-vehicle"');
    const none = renderStep('settings', { ...archive, vehicleIds: [] }, [rivian]);
    expect(none).toContain('No vehicle in this export is connected.');
    expect(none).toMatch(/disabled=""[^>]*>Review/);
  });

  it('asks for settings once there are files', () => {
    const html = renderStep('settings', draft);
    expect(html).toContain('Time zone');
    // The rule stays put while what the files cover fills in below it.
    expect(html).toContain('imported whole.');
    expect(html).toMatch(/<span class="\[grid-area:1\/1\] ">Choose the dates\./);
    // Held unseen until the dates are narrowed, so its showing doesn't re-wrap the text.
    expect(html).toMatch(/invisible">Use all dates</);
    // The others hold their space, unseen and unread.
    expect(html).toMatch(/aria-hidden="true" class="\[grid-area:1\/1\] invisible">Reading files…/);
    expect(html).toContain('Blue');
    expect(html).not.toContain('Model Y');
    expect(html).toContain('>Review</button>');
  });

  it('goes back to files if the upload has gone', () => {
    expect(renderStep('settings')).toContain('Step 2 of 4');
    expect(reachableStep('review', false)).toBe('files');
    expect(reachableStep('review', true)).toBe('review');
    expect(reachableStep('source', false)).toBe('source');
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
      'Also adds 786 history readings and detail on 1 charge.',
      'Skips 638 readings RivianMate already has.',
    ]);
  });

  it('tells readings it skips from ones it leaves for live tracking', () => {
    expect(importSummary({ ...preview, readingsNewer: 40 }).details).toEqual([
      'Also adds 500 history readings.',
      'Leaves 40 newer readings to live tracking.',
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

  it('names the places it adds, and counts the ones already saved', () => {
    const summary = importSummary({
      ...preview,
      readingsNew: 0,
      placesNew: ['Home', 'Work'],
      placesRecorded: 1,
    });
    expect(summary.details).toEqual([
      'Also adds 2 places (Home, Work).',
      'Skips 1 place already saved.',
    ]);
    const only = { ...preview, drivesNew: 0, sessionsNew: 0, readingsNew: 0 };
    expect(importSummary({ ...only, placesNew: ['Home'] }).canImport).toBe(true);
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
    expect(html({ warnings: ['odometer'] })).not.toContain('Check the vehicle');
    expect(renderToStaticMarkup(<OdometerWarning />)).toContain('Check the vehicle');
    expect(html({})).not.toContain('role="alert"');
  });
});
