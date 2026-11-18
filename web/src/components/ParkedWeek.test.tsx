// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parkedWeek } from '../lib/insights';
import { ParkedWeek } from './ParkedWeek';

afterEach(cleanup);

/** A day as the server reads it: that day's last 24 hours, sent at 21:14. */
const record = (
  day: number,
  kwh: number,
  uses = { climate: 0.2, system: 0.8, gearGuard: 0, outlets: 0 },
) => ({
  day: `2026-10-${String(day).padStart(2, '0')}`,
  at: new Date(2026, 9, day, 21, 14).toISOString(),
  minutes: 1440,
  kwh,
  rangeKm: 5.2,
  uses,
});

/** The morning of the 10th: the week is the 3rd to the 9th, whatever day the tests run on. */
const today = new Date(2026, 9, 10, 9, 0);
const week = (...records: ReturnType<typeof record>[]) => parkedWeek(records, 7, today);

const label = new Date(2026, 9, 9).toLocaleDateString([], {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const end = new Date(2026, 9, 9, 21, 14).toLocaleTimeString([], {
  hour: 'numeric',
  minute: '2-digit',
});

const readout = () => document.querySelector<HTMLElement>('.bar-readout');

describe('ParkedWeek', () => {
  it('draws one slot per day of the week, with the totals above them', () => {
    const { container } = render(<ParkedWeek days={week(record(9, 1.1))} />);
    expect(container.querySelectorAll('[data-day]')).toHaveLength(7);
    expect(screen.getByText('Last 7 days')).toBeTruthy();
    // The number comes first, so the shape is read against it.
    const totals = screen.getByText('1.1 kWh over 1 day');
    const bar = screen.getByRole('button');
    expect(totals.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('fills a slot for every day with a reading, and leaves the rest empty', () => {
    render(<ParkedWeek days={week(record(6, 1.1), record(9, 0.4))} />);
    expect(screen.getByText('1.5 kWh over 2 days')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getAllByRole('img', { name: /no parked energy reported/ })).toHaveLength(5);
  });

  it("reads out a day's window, total and uses", () => {
    render(<ParkedWeek days={week(record(9, 1.1))} />);
    fireEvent.click(screen.getByRole('button'));
    const card = readout();
    expect(card).not.toBeNull();
    // The 24 hours end at the day's last reading, so the readout says when.
    expect(within(card!).getByText(`${label} · 24 h to ${end}`)).toBeTruthy();
    expect(within(card!).getByText('1.1 kWh')).toBeTruthy();
    expect(within(card!).getByText('System')).toBeTruthy();
    expect(within(card!).getByText('0.8 kWh')).toBeTruthy();
    expect(within(card!).getByText('Climate')).toBeTruthy();
    expect(within(card!).getByText('0.2 kWh')).toBeTruthy();
    // Nothing in the other two uses, so neither is listed.
    expect(within(card!).queryByText('Gear Guard')).toBeNull();
  });

  it('says so where a day drew too little in any use to list', () => {
    render(
      <ParkedWeek days={week(record(9, 0, { climate: 0, system: 0, gearGuard: 0, outlets: 0 }))} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(within(readout()!).getByText('No use drew energy')).toBeTruthy();
  });

  it('labels each bar for a screen reader with its window and uses', () => {
    render(<ParkedWeek days={week(record(9, 1.1))} />);
    expect(
      screen.getByRole('button', {
        name: `${label}: 1.1 kWh used while parked over 24 h to ${end}, System 0.8 kWh, Climate 0.2 kWh`,
      }),
    ).toBeTruthy();
  });

  it('opens a reading on keyboard focus, and puts it away on Escape', () => {
    render(<ParkedWeek days={week(record(9, 1.1))} />);
    fireEvent.focus(screen.getByRole('button'));
    expect(readout()).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(readout()).toBeNull();
  });

  it('opens a reading on hover, and puts it away when the mouse leaves the bars', () => {
    render(<ParkedWeek days={week(record(9, 1.1))} />);
    fireEvent.pointerEnter(screen.getByRole('button'));
    expect(readout()).not.toBeNull();
    fireEvent.pointerLeave(readout()!.parentElement!, { pointerType: 'mouse' });
    expect(readout()).toBeNull();
  });

  it('puts the reading away when the reader taps elsewhere', () => {
    render(<ParkedWeek days={week(record(9, 1.1))} />);
    fireEvent.click(screen.getByRole('button'));
    expect(readout()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(readout()).toBeNull();
  });

  it('leaves a day with nothing reported unreadable', () => {
    render(<ParkedWeek days={week()} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const empties = screen.getAllByRole('img', { name: /no parked energy reported/ });
    expect(empties).toHaveLength(7);
    fireEvent.click(empties[0]!);
    expect(readout()).toBeNull();
  });

  it('draws nothing when there is no day to draw', () => {
    const { container } = render(<ParkedWeek days={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
