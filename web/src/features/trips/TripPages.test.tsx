import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { TripDetailDto, TripStatsDto, TripSummaryDto } from '@server/api-types';
import { ID, drives, sessions } from '../../testing/fixtures';
import { TripPage } from './TripPage';
import { TripTimeline } from './TripTimeline';
import { TripsPage } from './TripsPage';

const stats: TripStatsDto = {
  drives: 2,
  charges: 1,
  startedAt: '2026-06-01T17:00:00.000Z',
  endedAt: '2026-06-03T17:00:00.000Z',
  lastStartedAt: '2026-06-03T15:00:00.000Z',
  distanceKm: 800,
  drivesWithDistance: 2,
  drivingSeconds: 36000,
  chargingSeconds: 1800,
  chargesWithTime: 1,
  energyUsedKwh: 240,
  energyAddedKwh: 100,
  energyAddedEstimated: true,
  chargesWithEnergy: 1,
  efficiency: { distanceKm: 400, energyKwh: 120, drives: 1 },
  costs: [
    { currency: 'USD', amount: 40, estimated: false },
    { currency: 'CAD', amount: 12, estimated: true },
  ],
  chargesWithCost: 1,
};

const summary: TripSummaryDto = {
  id: 7,
  vehicleId: ID,
  name: 'Yosemite Road Trip 2026',
  notes: 'Bring the tent',
  startDate: null,
  endDate: null,
  timeZone: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  stats,
};

function withClient(client: QueryClient, path: string, element: React.ReactNode, route: string) {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TripsPage', () => {
  const render = (trips: TripSummaryDto[]) => {
    const client = new QueryClient();
    client.setQueryData(['trips', ID], trips);
    return withClient(client, '/trips', <TripsPage vehicleId={ID} />, '/trips');
  };

  it('invites the first trip', () => {
    expect(render([])).toContain('No trips yet');
  });

  it('summarizes each trip and links to it', () => {
    const html = render([summary]);
    expect(html).toContain('Yosemite Road Trip 2026');
    expect(html).toContain('href="/trips/7"');
    expect(html).toContain('2 drives');
    expect(html).toContain('efficiency');
  });

  it('puts a trip under way up top, with its figures large', () => {
    const today = new Date().toLocaleDateString('en-CA');
    const html = render([
      summary,
      { ...summary, id: 8, name: 'Out now', startDate: today, timeZone: 'UTC' },
    ]);
    expect(html).toContain('>Active</h2>');
    expect(html).not.toContain('Active trip');
    expect(html).toContain('Day 1');
    expect(html).toContain('Since ');
    expect(html.indexOf('Out now')).toBeLessThan(html.indexOf('Yosemite Road Trip 2026'));
  });

  it('says when a trip is still to come, and when its drives start joining', () => {
    const later = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString('en-CA');
    const html = render([
      {
        ...summary,
        startDate: later,
        timeZone: 'UTC',
        stats: { ...stats, drives: 0, charges: 0 },
      },
    ]);
    expect(html).toContain('Starts in 3 days');
    expect(html).toContain('Drives join from ');
  });

  it('groups trips to come apart from those done, soonest first', () => {
    const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA');
    const open = { timeZone: 'UTC' };
    const html = render([
      summary,
      { ...summary, ...open, id: 8, name: 'Later trip', startDate: inDays(9) },
      { ...summary, ...open, id: 9, name: 'Sooner trip', startDate: inDays(2) },
    ]);
    expect(html).toContain('>Upcoming</h2>');
    expect(html).toContain('>Completed</h2>');
    expect(html.indexOf('Sooner trip')).toBeLessThan(html.indexOf('Later trip'));
    expect(html.indexOf('Later trip')).toBeLessThan(html.indexOf('Yosemite Road Trip 2026'));
  });

  it('leaves out headings with only one kind of trip', () => {
    expect(render([summary])).not.toContain('>Completed</h2>');
  });
});

describe('TripPage', () => {
  const render = (over: Partial<TripDetailDto> = {}) => {
    const detail: TripDetailDto = {
      ...summary,
      drives,
      sessions: sessions.filter((s) => s.endedAt != null),
      missing: 0,
      ...over,
    };
    const client = new QueryClient();
    client.setQueryData(['trips', ID, 7], detail);
    client.setQueryData(['trips', ID, 7, 'route'], []);
    return withClient(client, '/trips/7', <TripPage vehicleId={ID} />, '/trips/:tripId');
  };

  it('shows the trip with its notes, figures and timeline', () => {
    const html = render();
    expect(html).toContain('Yosemite Road Trip 2026');
    expect(html).toContain('Bring the tent');
    expect(html).toContain('Time charging');
    expect(html).toContain('Work</span><span class="block truncate">→ Home');
  });

  it('marks estimates, keeps currencies apart and says what a figure covers', () => {
    const html = render();
    expect(html).toContain('≈ 100.0 kWh');
    expect(html).toContain('$40.00 + ≈ CAD 12.00');
    expect(html).toContain('1 of 2 drives');
  });

  it('says when some of the trip can’t be read', () => {
    expect(render({ missing: 2 })).toContain('2 activities in this trip');
  });

  it('has an empty state with nothing in the trip', () => {
    expect(render({ drives: [], sessions: [] })).toContain('Nothing in this trip yet');
  });

  it('says a trip is under way and offers to end it', () => {
    const today = new Date().toLocaleDateString('en-CA');
    const html = render({ startDate: today, timeZone: 'UTC' });
    expect(html).toContain('Active trip');
    expect(html).toContain('End trip today');
    expect(html).toContain('Since ');
  });

  it('says a trip is still to come, with nothing to end', () => {
    const later = new Date(Date.now() + 2 * 86_400_000).toLocaleDateString('en-CA');
    const html = render({ startDate: later, timeZone: 'UTC' });
    expect(html).toContain('Starts in 2 days');
    expect(html).not.toContain('End trip today');
  });
});

describe('TripTimeline', () => {
  const render = (props: Partial<Parameters<typeof TripTimeline>[0]> = {}) => {
    const trip: TripDetailDto = { ...summary, drives, sessions: [], missing: 0 };
    return withClient(
      new QueryClient(),
      '/',
      <TripTimeline
        trip={trip}
        selected={null}
        onSelect={() => {}}
        onRemove={() => {}}
        removed={null}
        onUndo={null}
        onFindMissing={() => {}}
        {...props}
      />,
      '/',
    );
  };

  it('keeps a removed drive’s place as a line to undo it', () => {
    const [first, ...rest] = drives;
    const html = render({
      trip: { ...summary, drives: rest, sessions: [], missing: 0 },
      removed: { kind: 'drive', drive: first! },
      onUndo: () => {},
    });
    expect(html).toContain('removed');
    expect(html).toMatch(/<button[^>]*>Undo<\/button>/);
  });

  it('opens a drive with its battery levels and moving speed', () => {
    const drive = { ...drives[0]!, movingSeconds: 1800 };
    const html = render({
      trip: { ...summary, drives: [drive], sessions: [], missing: 0 },
      selected: { kind: 'drive', id: drive.id },
    });
    expect(html).toContain('82% → 78%');
    expect(html).toContain('Avg moving');
  });

  it('opens a charge with its power and range added', () => {
    const session = { ...sessions[0]!, rangeAddedKm: 100 };
    const html = render({
      trip: { ...summary, drives: [], sessions: [session], missing: 0 },
      selected: { kind: 'charge', id: session.id },
    });
    expect(html).toContain('10.0 kW avg · 11.0 kW peak');
    expect(html).toContain('Range added');
  });

  it('holds off undoing until the removal is saved', () => {
    const html = render({ removed: { kind: 'drive', drive: drives[0]! }, onUndo: null });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Undo<\/button>/);
  });
});
