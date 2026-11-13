// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parkedNights, recordedNights } from '../lib/insights';
import { ParkedWeek } from './ParkedWeek';

afterEach(cleanup);

/** A night as RivianMate recorded it: the 24-hour window and when Rivian sent it. */
const record = (
  day: number,
  kwh: number,
  uses: { climate: number; system: number; gearGuard: number; outlets: number } | null = {
    climate: 0.2,
    system: 0.8,
    gearGuard: 0,
    outlets: 0,
  },
) => ({
  at: new Date(2026, 9, day, 0, 30).toISOString(),
  minutes: 1440,
  kwh,
  rangeKm: 5.2,
  uses,
});

/** The morning of the 8th: the week ends here, whatever day the tests run on. */
const today = new Date(2026, 9, 8, 9, 0);

/** A record sent just after midnight covers the night the clock has just left. */
const night = new Date(2026, 9, 8).toLocaleDateString([], {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

const readout = () => document.querySelector<HTMLElement>('.bar-readout');

describe('ParkedWeek', () => {
  it('draws one slot per night of the week, with the totals above them', () => {
    const { container } = render(
      <ParkedWeek nights={recordedNights([record(8, 1.1)], 7, today)} />,
    );
    expect(container.querySelectorAll('[data-night]')).toHaveLength(7);
    // The number comes first, so the shape is read against it.
    const totals = screen.getByText('1.1 kWh over 1 night');
    const bar = screen.getByRole('button');
    expect(totals.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('fills a slot for every night with a record, and leaves the rest empty', () => {
    render(<ParkedWeek nights={recordedNights([record(6, 1.1), record(8, 0.4)], 7, today)} />);
    expect(screen.getByText('1.5 kWh over 2 nights')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    // Five nights with nothing recorded stay as empty tracks.
    expect(screen.getAllByRole('img', { name: /no parked energy reported/ })).toHaveLength(5);
  });

  it("reads out a night's total and uses where the source splits them", () => {
    render(<ParkedWeek nights={recordedNights([record(8, 1.1)], 7, today)} />);
    fireEvent.click(screen.getByRole('button'));
    const card = readout();
    expect(card).not.toBeNull();
    // The window it covers, then the numbers the bar's width can't show.
    expect(within(card!).getByText(`${night} · the last 24 hours`)).toBeTruthy();
    expect(within(card!).getByText('1.1 kWh')).toBeTruthy();
    expect(within(card!).getByText('System')).toBeTruthy();
    expect(within(card!).getByText('0.8 kWh')).toBeTruthy();
    expect(within(card!).getByText('Climate')).toBeTruthy();
    expect(within(card!).getByText('0.2 kWh')).toBeTruthy();
    // Nothing in the other two uses, so neither is listed.
    expect(within(card!).queryByText('Gear Guard')).toBeNull();
  });

  it('says a total the source never split, rather than leaving the readout blank', () => {
    render(<ParkedWeek nights={recordedNights([record(8, 1.1, null)], 7, today)} />);
    fireEvent.click(screen.getByRole('button'));
    const card = readout();
    expect(within(card!).getByText('1.1 kWh')).toBeTruthy();
    expect(within(card!).getByText('Not split by use')).toBeTruthy();
    expect(within(card!).queryByText('System')).toBeNull();
  });

  it('opens a reading on keyboard focus, and puts it away on Escape', () => {
    render(<ParkedWeek nights={recordedNights([record(8, 1.1)], 7, today)} />);
    fireEvent.focus(screen.getByRole('button'));
    expect(readout()).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(readout()).toBeNull();
  });

  it('opens a reading on hover, and puts it away when the mouse leaves the bars', () => {
    render(<ParkedWeek nights={recordedNights([record(8, 1.1)], 7, today)} />);
    fireEvent.pointerEnter(screen.getByRole('button'));
    expect(readout()).not.toBeNull();
    fireEvent.pointerLeave(readout()!.parentElement!, { pointerType: 'mouse' });
    expect(readout()).toBeNull();
  });

  it('puts the reading away when the reader taps elsewhere', () => {
    render(<ParkedWeek nights={recordedNights([record(8, 1.1)], 7, today)} />);
    fireEvent.click(screen.getByRole('button'));
    expect(readout()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(readout()).toBeNull();
  });

  it('leaves a night with nothing reported unreadable', () => {
    render(<ParkedWeek nights={recordedNights([], 7, today)} />);
    // Nothing to hold: the empty slots aren't controls, and a click reads nothing.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const empties = screen.getAllByRole('img', { name: /no parked energy reported/ });
    expect(empties).toHaveLength(7);
    fireEvent.click(empties[0]!);
    expect(readout()).toBeNull();
  });

  it('leaves the night bars to speak for themselves, with no caveat under them', () => {
    const { container } = render(
      <ParkedWeek nights={recordedNights([record(8, 1.1)], 7, today)} />,
    );
    expect(container.innerHTML).not.toContain('another client swaps the two');
  });

  it('draws nothing when there is no night to draw', () => {
    const { container } = render(<ParkedWeek nights={[]} />);
    expect(container.innerHTML).toBe('');
    expect(parkedNights([], '')).toEqual([]);
  });
});
