// @vitest-environment jsdom
// The pack's verdict reads on two surfaces, the gauge and Health's pack panel.
// This pins that both take it from the one helper and paint it in the one color,
// so a second copy can't quietly reappear on either side.
import type { VehicleInsightsDto, VehicleState } from '@server/api-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChargeGauge } from './features/dashboard/ChargeGauge';
import { PackDetails } from './features/health/PackDetails';
import { powerOutputVerdict, type PowerOutputVerdict } from './lib/vehicleStatus';

afterEach(cleanup);

const insights = {
  cellTemps: { avgC: 24, maxC: 27, minC: 22, at: '2026-11-12T09:00:00Z' },
  cellTempsCurrent: true,
  coldWeather: null,
} as unknown as VehicleInsightsDto;

const state = (fields: Record<string, string | number>) =>
  Object.fromEntries(
    Object.entries(fields).map(([k, value]) => [k, { timeStamp: 't', value }]),
  ) as unknown as VehicleState;

/** Both surfaces, handed the one helper's answer. */
const renderBoth = (verdict: PowerOutputVerdict | null) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChargeGauge level={61} limit={70} charging={false} verdict={verdict} />
      <PackDetails insights={insights} powerOutput={verdict} />
    </QueryClientProvider>,
  );

describe("the pack's verdict on both surfaces", () => {
  it('reads the cold limit on the gauge and beside the cell temperature', () => {
    renderBoth(powerOutputVerdict(state({ batteryPowerOutputStatus: 'cold' })));
    const verdicts = screen.getAllByText('cold-limited');
    expect(verdicts).toHaveLength(2);
    for (const element of verdicts) expect(element.className).toContain('text-(--status-cold)');
  });

  it('reads a pack the cold is not limiting in the healthy green, in both places', () => {
    renderBoth(powerOutputVerdict(state({ batteryPowerOutputStatus: 'normal' })));
    const verdicts = screen.getAllByText('normal');
    expect(verdicts).toHaveLength(2);
    for (const element of verdicts) expect(element.className).toContain('text-(--status-good)');
  });

  it('shows nothing on either surface for a vehicle that sends no verdict', () => {
    renderBoth(powerOutputVerdict(state({ batteryLevel: 61 })));
    // Both surfaces are drawn; neither names a verdict.
    expect(screen.getByRole('meter', { name: 'Battery level' })).toBeTruthy();
    expect(screen.getByText('Cell temperature')).toBeTruthy();
    expect(screen.queryAllByText('cold-limited')).toHaveLength(0);
    expect(screen.queryAllByText('normal')).toHaveLength(0);
  });
});
