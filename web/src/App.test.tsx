import type { StatusResponse } from '@server/api-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from './App';
import { DEFAULT_UNITS } from './lib/units';

/** Signed in with a source connected, but no vehicles came back from it. */
function render(path: string, status: Partial<StatusResponse> = {}) {
  const client = new QueryClient();
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
  it('says so on the vehicle pages and points to Settings', () => {
    const html = render('/history');
    expect(html).toContain('No vehicles found.');
    expect(html).toContain('href="/settings"');
  });

  it('still opens Settings, to fix the connection', () => {
    const html = render('/settings');
    expect(html).not.toContain('No vehicles found.');
    expect(html).toContain('Settings</h1>');
  });
});

describe('App during first-run setup', () => {
  it('asks which outside services to allow once the account is connected', () => {
    const html = render('/', { rivianConnected: true, needsLookupChoice: true });
    expect(html).toContain('Outside services');
    expect(html).toContain('306 W Willow St');
    expect(html).toContain('Step 4 of 4');
    expect(html).not.toContain('No vehicles found.');
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
});
