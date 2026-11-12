// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VehicleInsightsDto } from '@server/api-types';
import { ParkedEnergyPanel } from './ParkedEnergyPanel';

// No recorded nights and no unit preferences: the panel draws the live report.
vi.mock('../api/hooks', () => ({
  useParkedNights: () => ({ data: undefined }),
  useUnits: () => ({ formatDistance: (km: number) => `${Math.round(km * 0.621371)} mi` }),
}));

afterEach(cleanup);

const uses = (climate: number, system: number, gearGuard: number, outlets: number) => ({
  climate,
  system,
  gearGuard,
  outlets,
});

/** Rivian's report, as the API hands it over: one window, no history recorded. */
const insights = (
  windows: {
    minutes: number;
    kwh: number;
    rangeKm: number;
    uses: ReturnType<typeof uses> | null;
  }[],
) =>
  ({
    parkedEnergy: { windows, at: new Date(2026, 9, 8, 9, 0).toISOString() },
  }) as unknown as VehicleInsightsDto;

const readout = () => document.querySelector<HTMLElement>('.bar-readout');

describe('ParkedEnergyPanel', () => {
  it("reads out a window's total and uses where the source splits them", () => {
    render(
      <ParkedEnergyPanel
        insights={insights([
          { minutes: 1440, kwh: 1.5, rangeKm: 16.1, uses: uses(0.3, 1.1, 0.1, 0) },
        ])}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /^Last 24 hours: 1\.5 kWh used while parked/ }),
    );
    const card = readout();
    expect(card).not.toBeNull();
    expect(within(card!).getByText('Last 24 hours')).toBeTruthy();
    expect(within(card!).getByText('1.5 kWh')).toBeTruthy();
    expect(within(card!).getByText('System')).toBeTruthy();
    expect(within(card!).getByText('1.1 kWh')).toBeTruthy();
    expect(within(card!).getByText('Climate')).toBeTruthy();
    expect(within(card!).getByText('Gear Guard')).toBeTruthy();
    // Outlets drew nothing.
    expect(within(card!).queryByText('Outlets')).toBeNull();
  });

  it("says a TeslaMate window's total isn't split, and still gives the total", () => {
    render(
      <ParkedEnergyPanel
        insights={insights([{ minutes: 480, kwh: 2.4, rangeKm: 30, uses: null }])}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /^Last 8 hours: 2\.4 kWh used while parked/ }),
    );
    const card = readout();
    expect(within(card!).getByText('2.4 kWh')).toBeTruthy();
    expect(within(card!).getByText('Not split by use')).toBeTruthy();
    expect(within(card!).queryByText('System')).toBeNull();
  });

  it('opens a reading on keyboard focus, and puts it away on Escape', () => {
    render(
      <ParkedEnergyPanel
        insights={insights([{ minutes: 480, kwh: 2.4, rangeKm: 30, uses: null }])}
      />,
    );
    fireEvent.focus(screen.getByRole('button', { name: /^Last 8 hours/ }));
    expect(readout()).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(readout()).toBeNull();
  });

  it('says so where nothing has been reported, without a bar to read', () => {
    render(<ParkedEnergyPanel insights={insights([])} />);
    expect(screen.getByText('No parked energy reported yet.')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
