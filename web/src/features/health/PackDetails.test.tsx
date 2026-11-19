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

describe('PackDetails power output', () => {
  it('reads a cold limit in the cold color', () => {
    const html = render({ powerOutput: 'cold' });
    expect(html).toContain('Power output');
    expect(html).toContain('<span class="text-(--status-cold)">Limited by cold</span>');
  });

  it('reads Normal for a pack that is not limited', () => {
    expect(render({ powerOutput: 'normal' })).toMatch(/Power output<\/dt><dd[^>]*>Normal<\/dd>/);
  });

  it('reads — while the pack is not reporting', () => {
    expect(render({ powerOutput: null })).toMatch(/Power output<\/dt><dd[^>]*>—<\/dd>/);
  });

  it('leaves the row out for a vehicle that never sends a verdict', () => {
    const html = render();
    expect(html).not.toContain('Power output');
    expect(html).toContain('Cell temperature');
  });
});
