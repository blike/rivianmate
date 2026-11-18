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
/** The one day with a reading, in tests that draw one. */
const bar = () => screen.getByRole('button', { name: /used while parked/ });
const empties = () => screen.queryAllByRole('button', { name: /No reading/ });

describe('ParkedWeek', () => {
  it('draws one slot per day of the week, with the totals above them', () => {
    const { container } = render(<ParkedWeek days={week(record(9, 1.1))} />);
    expect(container.querySelectorAll('[data-day]')).toHaveLength(7);
    expect(screen.getByText('Last 7 days')).toBeTruthy();
    // The number comes first, so the shape is read against it.
    const totals = screen.getByText('1.1 kWh over 1 day');
    const first = bar();
    expect(totals.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('fills a slot for every day with a reading, and leaves the rest empty', () => {
    render(<ParkedWeek days={week(record(6, 1.1), record(9, 0.4))} />);
    expect(screen.getByText('1.5 kWh over 2 days')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /used while parked/ })).toHaveLength(2);
    expect(empties()).toHaveLength(5);
  });

  it("reads out a day's window, total and uses", () => {
    render(<ParkedWeek days={week(record(9, 1.1))} />);
    fireEvent.click(bar());
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
    fireEvent.click(bar());
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
    fireEvent.focus(bar());
    expect(readout()).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(readout()).toBeNull();
  });

  it('opens a reading on hover, and puts it away when the mouse leaves the bars', () => {
    render(<ParkedWeek days={week(record(9, 1.1))} />);
    fireEvent.pointerEnter(bar());
    expect(readout()).not.toBeNull();
    fireEvent.pointerLeave(readout()!.parentElement!, { pointerType: 'mouse' });
    expect(readout()).toBeNull();
  });

  it('puts the reading away when the reader taps elsewhere', () => {
    render(<ParkedWeek days={week(record(9, 1.1))} />);
    fireEvent.click(bar());
    expect(readout()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(readout()).toBeNull();
  });

  it('says why a day has no bar, rather than passing it off as a day that used nothing', () => {
    render(<ParkedWeek days={week(record(9, 1.1))} />);
    expect(empties()).toHaveLength(6);
    fireEvent.click(empties()[0]!);
    const card = readout();
    const monday = new Date(2026, 9, 3).toLocaleDateString([], {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    expect(within(card!).getByText(monday)).toBeTruthy();
    expect(within(card!).getByText(/only when the car is driven/)).toBeTruthy();
    // No reading means no numbers, not a total of zero.
    expect(within(card!).queryByText('Total')).toBeNull();
  });

  it('draws nothing when there is no day to draw', () => {
    const { container } = render(<ParkedWeek days={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
