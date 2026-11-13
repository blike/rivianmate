import type { OrdersDto, StatusResponse } from '@server/api-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from './App';
import { DEFAULT_UNITS } from './lib/units';

/** Signed in with a source connected, but no vehicles came back from it. */
function render(path: string, status: Partial<StatusResponse> = {}, orders?: Partial<OrdersDto>) {
  const client = new QueryClient();
  if (orders)
    client.setQueryData(['orders'], {
      journeys: [],
      checkedAt: null,
      refreshMinutes: 15,
      ...orders,
    });
  client.setQueryData(['status'], {
    needsSetup: false,
    authed: true,
    rivianConnected: false,
    rivianAuthState: null,
    rivianEmail: null,
    mockMode: false,
    teslamateConfigured: true,
    needsLookupChoice: false,
    signInStartsSetup: false,
    ...status,
  });
  client.setQueryData(['vehicles'], []);
  client.setQueryData(['units'], DEFAULT_UNITS);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('App without vehicles', () => {
  it('says there is no vehicle yet, and points to the connections', () => {
    const html = render('/', {}, { journeys: [], checkedAt: '2026-11-10T15:00:00Z' });
    expect(html).toContain('No vehicle connected yet');
    expect(html).toContain('href="/settings"');
  });

  it('with Rivian connected and nothing on order, says so', () => {
    const html = render(
      '/',
      { rivianConnected: true },
      { journeys: [], checkedAt: '2026-11-10T15:00:00Z', refreshMinutes: 15 },
    );
    expect(html).toContain('No Rivian here yet');
  });

  it('shows the order on its way as home, with Delivery as the only section', () => {
    const html = render(
      '/',
      { rivianConnected: true },
      {
        checkedAt: '2026-11-10T15:00:00Z',
        refreshMinutes: 15,
        journeys: [
          {
            orderId: 'o1',
            delivered: false,
            vehicleId: null,
            state: 'ORDERED',
            fulfillmentSummaryStatus: 'PENDING_FULFILLMENT',
            detail: {
              ok: true,
              value: {
                id: 'o1',
                type: 'VEHICLE',
                state: 'ORDERED',
                orderDate: '2026-04-02T15:20:11.000Z',
                configurationStatus: null,
                fulfillmentSummaryStatus: null,
                vehicle: null,
                items: [{ type: 'VEHICLE', title: 'Rivian R2', options: [] }],
                reservedDate: null,
                orderedDate: '2026-04-02T15:20:11.000Z',
                payments: [],
                estimatedDelivery: null,
              },
            },
            delivery: { ok: true, value: null },
            renders: [],
          },
        ],
      },
    );
    expect(html).toContain('Your R2 is on order');
    expect(html).toContain('On its way');
    expect(html).toContain('>Delivery<');
    expect(html).not.toContain('>Drives<');
  });

  it('still opens Settings, to fix the connection', () => {
    const html = render('/settings');
    expect(html).not.toContain('No vehicle connected yet');
    expect(html).toContain('>Settings</div>');
    expect(html).toContain('General</h1>');
  });
});

describe('App during first-run setup', () => {
  it('asks which outside services to allow once the account is connected', () => {
    const html = render('/', { rivianConnected: true, needsLookupChoice: true });
    expect(html).toContain('Outside services');
    expect(html).toContain('306 W Willow St');
    expect(html).toContain('Step 4 of 4');
    expect(html).not.toContain('No vehicle connected yet');
  });

  it('shows signing in as step 1 when APP_PASSWORD set the password', () => {
    const html = render('/', { authed: false, needsLookupChoice: true, signInStartsSetup: true });
    expect(html).toContain('Step 1 of 4');
    expect(html).toContain('APP_PASSWORD');
  });

  it('signs in without setup steps otherwise', () => {
    const html = render('/', { authed: false, needsLookupChoice: true });
    expect(html).toContain('Welcome back');
    expect(html).not.toContain('Step 1 of 4');
  });

  it('shows connecting Rivian as step 2', () => {
    const html = render('/', { teslamateConfigured: false, needsLookupChoice: true });
    expect(html).toContain('Connect your Rivian account');
    expect(html).toContain('Step 2 of 4');
  });
});

describe('App after setup', () => {
  it('connects a new Rivian account without setup steps', () => {
    const html = render('/', { teslamateConfigured: false });
    expect(html).toContain('Connect your Rivian account');
    expect(html).not.toContain('aria-label="Change email"');
    expect(html).not.toContain('of 4');
  });

  it('reconnects a known account with its email locked until changed', () => {
    const html = render('/', {
      teslamateConfigured: false,
      rivianAuthState: 'unauthenticated',
      rivianEmail: 'owner@example.com',
    });
    expect(html).toContain('Reconnect your Rivian account');
    const input = html.match(/<input[^>]*type="email"[^>]*>/)?.[0];
    expect(input).toContain('value="owner@example.com"');
    expect(input).toMatch(/readonly/i);
    expect(html).toContain('aria-label="Change email"');
    expect(html).not.toContain('of 4');
  });
});
