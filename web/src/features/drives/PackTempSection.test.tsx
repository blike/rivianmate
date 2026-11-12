import type { DriveDetailDto } from '@server/api-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ID } from '../../testing/fixtures';
import { PackTempSection } from './PackTempSection';

const START = Date.parse('2026-10-12T14:00:00Z');
const MIN = 60_000;
const at = (minutes: number) => new Date(START + minutes * MIN).toISOString();

const drive = (over: Partial<DriveDetailDto> = {}): DriveDetailDto =>
  ({
    id: 2,
    startedAt: at(0),
    endedAt: at(60),
    points: [],
    ...over,
  }) as DriveDetailDto;

/** History as the route returns it: the average, the coldest and hottest cell. */
const rows = (readings: [minutes: number, avgC: number, minC: number, maxC: number][]) =>
  readings.map(([minutes, avg, min, max]) => ({
    bucket: at(minutes),
    avg,
    min,
    max,
  }));

function render(d: DriveDetailDto | undefined, history: object[] = []) {
  const client = new QueryClient();
  client.setQueryData(['units'], { distance: 'mi', temperature: 'F' });
  if (d) client.setQueryData(['packTemps', ID, d.id, d.endedAt], history);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PackTempSection vehicleId={ID} drive={d} loading={false} />
    </QueryClientProvider>,
  );
}

describe('PackTempSection', () => {
  it('shows the temperature at each end and the change between them', () => {
    const html = render(
      drive(),
      rows([
        [0, 20, 19, 21],
        [30, 21, 20, 22],
        [60, 23, 22, 24],
      ]),
    );
    expect(html).toContain('Pack temperature');
    expect(html).toContain('At start');
    expect(html).toContain('At end');
    // 20 °C and 23 °C, and three degrees of change.
    expect(html).toContain('68 °F');
    expect(html).toContain('73 °F');
    expect(html).toContain('+5 °F');
    expect(html).toContain('over 1h 0m');
  });

  it('draws the line and the band it sits in', () => {
    const html = render(
      drive(),
      rows([
        [0, 20, 19, 21],
        [60, 23, 22, 24],
      ]),
    );
    expect(html).toContain('recharts-responsive-container');
    expect(html).not.toContain('No pack temperature was recorded');
  });

  it('shows the end it has and leaves the other unknown when readings stop early', () => {
    const html = render(
      drive(),
      rows([
        [0, 20, 19, 21],
        [10, 21, 20, 22],
      ]),
    );
    expect(html).toContain('68 °F');
    expect(html).toContain('Not recorded');
    expect(html).toContain('Needs both');
    expect(html).not.toContain('+');
  });

  it('says so when the drive has no readings at all', () => {
    const html = render(drive(), []);
    expect(html).toContain('No pack temperature was recorded on this drive');
    // The figures keep their shape, with nothing in them.
    expect(html).toContain('At start');
    expect(html).toContain('—');
  });

  it('says a single reading is no trend to draw', () => {
    const html = render(drive(), rows([[30, 21, 20, 22]]));
    expect(html).toContain('One pack temperature reading');
  });

  it('leaves an end unknown when the only reading is nowhere near it', () => {
    // A reading in the middle of the drive stands for neither end.
    const html = render(drive(), rows([[30, 21, 20, 22]]));
    expect(html).not.toContain('70 °F');
    expect(html).toContain('Not recorded');
  });

  it('renders the section’s shape before any drive is chosen', () => {
    const html = render(undefined, []);
    expect(html).toContain('Pack temperature');
    expect(html).toContain('At end');
  });
});
