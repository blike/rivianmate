import type { VehicleInsightsDto } from '@server/api-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PackDetails } from './PackDetails';

const insights = {
  cellTemps: { avgC: 24, maxC: 27, minC: 22, at: '2026-11-12T09:00:00Z' },
  cellTempsCurrent: true,
  coldWeather: null,
} as unknown as VehicleInsightsDto;

const render = (props: Partial<Parameters<typeof PackDetails>[0]> = {}) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <PackDetails insights={insights} {...props} />
    </QueryClientProvider>,
  );

describe('PackDetails power output verdict', () => {
  it('names a cold limit beside the cell temperature', () => {
    const html = render({ powerOutput: 'cold' });
    expect(html).toContain('cold-limited');
    expect(html).not.toContain('>normal<');
  });

  it('reads normal for a pack the BMS is not limiting', () => {
    const html = render({ powerOutput: 'normal' });
    expect(html).toContain('>normal<');
    expect(html).not.toContain('cold-limited');
  });

  it('shows no verdict at all for a vehicle that never sends one', () => {
    const html = render();
    expect(html).not.toContain('normal');
    expect(html).not.toContain('cold-limited');
    // The row it belongs on is unchanged.
    expect(html).toContain('Cell temperature');
    expect(html).toContain('Cell temperatures are reported only while the vehicle is awake.');
  });
});
