import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from './App';
import { DEFAULT_UNITS } from './lib/units';

/** Signed in with a source connected, but no vehicles came back from it. */
function render(path: string) {
  const client = new QueryClient();
  client.setQueryData(['status'], {
    needsSetup: false,
    authed: true,
    rivianConnected: false,
    rivianAuthState: null,
    rivianEmail: null,
    mockMode: false,
    teslamateConfigured: true,
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
