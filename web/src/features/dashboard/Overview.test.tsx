// @vitest-environment jsdom
// The dashboard's own figures: the range, and the pack temperature read beside
// it in the same type. The state here carries no fix, so the map stays out of it.
import type { VehicleInsightsDto, VehicleState } from '@server/api-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ID, ago, vehicle } from '../../testing/fixtures';
import { Overview } from './Overview';

afterEach(cleanup);

const state = (fields: Record<string, string | number>) =>
  Object.fromEntries(
    Object.entries(fields).map(([k, value]) => [k, { timeStamp: ago(0.1), value }]),
  ) as unknown as VehicleState;

/** A parked vehicle, and whatever pack fields the test hands it. */
const parked = (fields: Record<string, string | number>) =>
  state({
    batteryLevel: 61,
    batteryLimit: 70,
    distanceToEmpty: 342,
    gearStatus: 'park',
    powerState: 'ready',
    chargerStatus: 'chrgr_sts_not_connected',
    ...fields,
  });

function renderOverview(
  s: VehicleState,
  coldWeather: NonNullable<VehicleInsightsDto['coldWeather']> | null = null,
) {
  const client = new QueryClient();
  client.setQueryData(['units'], { distance: 'mi', temperature: 'F' });
  client.setQueryData(['liveCharging', ID], null);
  client.setQueryData(['insights', ID], {
    cellTemps: null,
    cellTempsCurrent: false,
    coldWeather,
    parkedEnergy: null,
    navigation: null,
    connectivity: null,
  });
  client.setQueryData(['drives', ID], []);
  client.setQueryData(['chargingSessions', ID], []);
  render(
    <QueryClientProvider client={client}>
      <Overview vehicleId={ID} vehicle={vehicle} state={s} />
    </QueryClientProvider>,
  );
}

/** The figure's block, and the row it sits in, one level up from the label. */
const blockOf = (label: HTMLElement) => label.parentElement!;
const rowOf = (label: HTMLElement) => blockOf(label).parentElement!;

describe("Overview's pack temperature", () => {
  it('reads the pack beside the range, in the same figures and to its right', () => {
    renderOverview(parked({ batteryTempAvg: 21, batteryPowerOutputStatus: 'normal' }));
    const range = screen.getByText('Est. range');
    const pack = screen.getByText('Pack');
    // One row, the range first and the pack after it.
    expect(rowOf(pack)).toBe(rowOf(range));
    expect([...rowOf(range).children].indexOf(blockOf(pack))).toBeGreaterThan(
      [...rowOf(range).children].indexOf(blockOf(range)),
    );
    // 21 °C, read in the dashboard's degrees, in the range's own pairing of
    // a big number and a muted unit: the same type size, weight and colour.
    const packFigure = blockOf(pack).querySelector('.readout')!;
    const rangeFigure = blockOf(range).querySelector('.readout')!;
    expect(packFigure.textContent).toBe('70');
    expect(packFigure.className).toBe(rangeFigure.className);
    const packUnit = blockOf(pack).querySelectorAll('span')[1]!;
    const rangeUnit = blockOf(range).querySelectorAll('span')[1]!;
    expect(packUnit.textContent).toBe('°F');
    expect(packUnit.className).toBe(rangeUnit.className);
  });

  it("reserves a line for the range's cold note", () => {
    renderOverview(parked({ batteryTempAvg: 21, batteryPowerOutputStatus: 'normal' }), {
      rangeImpactKm: 24,
      coldSoc: 80,
      usableSoc: null,
      at: ago(0.1),
    });
    const row = rowOf(screen.getByText('Est. range'));
    // The note is written, and the row carries room for the line it hangs into.
    expect(screen.getByText(/from the cold/)).toBeTruthy();
    expect(row.className).toContain('pb-5');
  });

  it('reserves a second line when the range is low as well', () => {
    renderOverview(
      parked({
        batteryTempAvg: 21,
        batteryPowerOutputStatus: 'normal',
        rangeThreshold: 'critically_low',
      }),
      { rangeImpactKm: 24, coldSoc: 80, usableSoc: null, at: ago(0.1) },
    );
    const row = rowOf(screen.getByText('Est. range'));
    expect(row.className).toContain('pb-10');
    // Two lines of text need their own clearance from anything wrapped below.
    expect(row.className).toContain('gap-y-10');
  });

  it('reserves nothing for a vehicle with neither a low range nor a cold line', () => {
    renderOverview(parked({ batteryTempAvg: 21, batteryPowerOutputStatus: 'normal' }));
    expect(rowOf(screen.getByText('Est. range')).className).not.toMatch(/pb-\d/);
  });

  it('reads the temperature from a pack that sends it without a verdict', () => {
    // The frame records the two independently: field 4 can be absent while the cells report.
    renderOverview(parked({ batteryTempAvg: 21 }));
    expect(screen.getByText('Pack')).toBeTruthy();
    expect(screen.getByText('70')).toBeTruthy();
  });

  it("shows nothing extra for a vehicle that never sends the pack's frames", () => {
    renderOverview(parked({}));
    expect(screen.queryByText('Pack')).toBeNull();
  });
});
