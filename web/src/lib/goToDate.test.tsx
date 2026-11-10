// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIST_LIMIT } from '@server/list-page';
import { type PageParam, usePages } from '../api/hooks';
import { DayCalendar } from '../components/DayCalendar';
import { useGoToDate } from './goToDate';

type Listed = { id: number; startedAt: string };

/** A drive a day at noon, newest (id 0) today, back `n` days. */
function history(n: number): Listed[] {
  const now = new Date();
  return Array.from({ length: n }, (_, id) => ({
    id,
    startedAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() - id, 12).toISOString(),
  }));
}

/** Reads pages as the server does: newest first, a page above nearest it first. */
function server(all: Listed[]) {
  const at = (r: Listed) => Date.parse(r.startedAt);
  const fetchPage = vi.fn(async (page: PageParam) => {
    if (page.after) {
      const after = page.after.getTime() + 1;
      // Newest first already: the last of those after it are the nearest.
      return all.filter((r) => at(r) >= after).slice(-LIST_LIMIT);
    }
    const before = page.before?.getTime() ?? Infinity;
    return all.filter((r) => at(r) < before).slice(0, LIST_LIMIT);
  });
  const fetchWindow = vi.fn(async (from: Date, to: Date) =>
    all.filter((r) => at(r) >= from.getTime() && at(r) <= to.getTime()),
  );
  return { fetchPage, fetchWindow };
}

function List(props: ReturnType<typeof server>) {
  const pages = usePages(['drives', 'v1', 'pages'], props.fetchPage, () => 60_000);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const goTo = useGoToDate({
    queryKey: ['drives', 'v1'],
    fetchWindow: props.fetchWindow,
    listed: pages.items,
    jumpTo: pages.jumpTo,
    selected: pages.items?.find((r) => r.id === selectedId),
    onSelect: setSelectedId,
  });
  return (
    <>
      <DayCalendar noun="drive" {...goTo.calendar} />
      {pages.hasNewer && (
        <>
          <button onClick={pages.loadNewer}>Show newer</button>
          <button onClick={() => pages.jumpTo(null)}>Back to latest</button>
        </>
      )}
      <ul aria-label="Drives">
        {pages.items?.map((r) => (
          <li key={r.id}>{r.id === selectedId ? `${r.id} (picked)` : r.id}</li>
        ))}
      </ul>
    </>
  );
}

function renderList(all: Listed[]) {
  const api = server(all);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <List {...api} />
    </QueryClientProvider>,
  );
  return api;
}

const ids = () =>
  within(screen.getByRole('list', { name: 'Drives' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

/** Opens the calendar, steps back to `record`'s month, and picks its day. */
async function pick(record: Listed) {
  fireEvent.click(screen.getByRole('button', { name: 'Pick a day to show drives from' }));
  const day = new Date(record.startedAt);
  const now = new Date();
  const back = (now.getFullYear() - day.getFullYear()) * 12 + now.getMonth() - day.getMonth();
  for (let i = 0; i < back; i++) {
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
  }
  const label = day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  fireEvent.click(await screen.findByRole('button', { name: `${label}: 1 drive` }));
}

describe('going to a date in a list read a page at a time', () => {
  afterEach(cleanup);

  it('opens the list at a day years back with one read, not every page since', async () => {
    const all = history(1000);
    const { fetchPage } = renderList(all);
    await waitFor(() => expect(ids()).toHaveLength(LIST_LIMIT));

    const target = all[900]!;
    await pick(target);

    await waitFor(() => expect(ids()[0]).toBe('900 (picked)'));
    // The newest page, then the page from the day picked: none of the four between.
    expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([
      {},
      { before: new Date(Date.parse(target.startedAt) + 1) },
    ]);
    expect(ids()).toHaveLength(100);

    // Above it, the page of newer ones, nearest first.
    fireEvent.click(screen.getByRole('button', { name: 'Show newer' }));
    await waitFor(() => expect(ids()).toHaveLength(300));
    expect(fetchPage).toHaveBeenLastCalledWith({ after: new Date(target.startedAt) });
    expect([ids()[0], ids()[199], ids()[200]]).toEqual(['700', '899', '900 (picked)']);

    // And straight back to the newest.
    fireEvent.click(screen.getByRole('button', { name: 'Back to latest' }));
    await waitFor(() => expect(ids()[0]).toBe('0'));
    expect(screen.queryByRole('button', { name: 'Show newer' })).toBeNull();
  });

  it('picks a day already listed without reading the list again', async () => {
    const all = history(300);
    const { fetchPage } = renderList(all);
    await waitFor(() => expect(ids()).toHaveLength(LIST_LIMIT));

    await pick(all[40]!);

    await waitFor(() => expect(ids()[40]).toBe('40 (picked)'));
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Show newer' })).toBeNull();
  });
});
