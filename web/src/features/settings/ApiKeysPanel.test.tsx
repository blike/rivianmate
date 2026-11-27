import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ApiKeyDto } from '../../api/client';
import { ApiKeysPanel } from './ApiKeysPanel';

const render = (keys: ApiKeyDto[]) => {
  const client = new QueryClient();
  client.setQueryData(['apiKeys'], keys);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ApiKeysPanel />
    </QueryClientProvider>,
  );
};

describe('ApiKeysPanel', () => {
  it('lists each key with its prefix, usage, and expiry badge', () => {
    const html = render([
      {
        id: 1,
        name: 'Homepage',
        prefix: 'rmk_abcdef12',
        createdAt: '2026-11-01T12:00:00.000Z',
        lastUsedAt: null,
        expiresAt: null,
      },
      {
        id: 2,
        name: 'Old script',
        prefix: 'rmk_99999999',
        createdAt: '2026-01-01T12:00:00.000Z',
        lastUsedAt: '2026-06-01T12:00:00.000Z',
        expiresAt: '2020-01-01T00:00:00.000Z',
      },
    ]);
    expect(html).toContain('Homepage');
    expect(html).toContain('rmk_abcdef12…');
    expect(html).toContain('Never used');
    expect(html).toContain('Old script');
    expect(html).toContain('Expired');
    expect(html).not.toContain('Read &amp; write');
  });

  it('invites creating a key when there are none', () => {
    expect(render([])).toContain('No API keys yet');
  });
});
