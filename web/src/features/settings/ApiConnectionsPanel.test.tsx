import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FeedLatestData, RivianDiagnosticsResponse } from '../../api/client';
import { ApiConnectionsPanel, FeedLatestBody } from './ApiConnectionsPanel';

const diagnostics: RivianDiagnosticsResponse = {
  monitor: {
    running: true,
    streamConnected: true,
    fallbackPolling: false,
    pollingStatus: 'standby',
    consecutiveAuthFailures: 0,
    parallaxMode: 'classic',
    parallaxModes: {},
    parallaxDroppedFields: [],
    subscriptions: {
      state: 'connected',
      lastMessageAt: '2026-10-05T01:00:00Z',
      feeds: [
        {
          id: 'v',
          vehicleId: 'v1',
          kind: 'vehicleState',
          domain: null,
          topics: [],
          status: 'receiving',
          lastMessageAt: '2026-10-05T01:00:00Z',
        },
        {
          id: 'p',
          vehicleId: 'v1',
          kind: 'parallax',
          domain: 'energy',
          topics: [{ rvm: 'energy.high_voltage.battery_state', kind: 'read' }],
          status: 'unsupported',
          lastMessageAt: null,
        },
        {
          id: 'c',
          vehicleId: 'v1',
          kind: 'chargingSession',
          domain: null,
          topics: [],
          status: 'waiting',
          lastMessageAt: null,
        },
      ],
    },
  },
  traffic: {
    since: '2026-10-05T00:00:00Z',
    lastSuccessfulRequestAt: '2026-10-05T01:00:00Z',
    cooldownUntil: null,
    lastRateLimitedAt: null,
    requestsByOperation24h: {},
    last24h: {
      httpRequests: 1,
      httpErrors: 0,
      rateLimited: 0,
      sessionRefreshes: 0,
      wsConnects: 1,
      wsReconnects: 2,
      wsDrops: 1,
      wsMessages: 3,
      wsAuthFailures: 0,
    },
  },
};

describe('API connections', () => {
  it('shows a feed of only empty readings (an R2) as no data, and names OTA', () => {
    const feeds = diagnostics.monitor.subscriptions!.feeds;
    const html = renderToStaticMarkup(
      <ApiConnectionsPanel
        diagnostics={{
          ...diagnostics,
          monitor: {
            ...diagnostics.monitor,
            subscriptions: {
              ...diagnostics.monitor.subscriptions!,
              feeds: [
                { ...feeds[0]!, status: 'empty' },
                {
                  ...feeds[1]!,
                  id: 'o',
                  domain: 'ota',
                  topics: [{ rvm: 'ota.deployment.state', kind: 'read' }],
                },
              ],
            },
          },
        }}
        loading={false}
        error={false}
        vehicles={[]}
        mockMode={false}
      />,
    );
    expect(html).toContain('No data');
    expect(html).toContain('>OTA<');
    expect(html).toContain('0 of 1 receiving');
  });

  it('shows independent feed statuses and request, polling, and socket health', () => {
    const html = renderToStaticMarkup(
      <ApiConnectionsPanel
        diagnostics={diagnostics}
        loading={false}
        error={false}
        vehicles={[]}
        mockMode={false}
      />,
    );
    for (const text of [
      'Last successful request',
      'Off · live stream connected',
      'connected',
      'Dropped connections',
      'Receiving',
      'Unsupported',
      'Waiting',
      'Last data:',
      'aria-label="Legacy feeds"',
      'aria-label="Parallax feeds"',
      'Latest data',
    ])
      expect(html).toContain(text);
    expect(html).not.toContain('Monitoring is stopped');
    expect(html).not.toContain('Session refreshes');
  });

  it('does not present a failed diagnostics request as a stopped monitor', () => {
    const html = renderToStaticMarkup(
      <ApiConnectionsPanel
        diagnostics={undefined}
        loading={false}
        error
        vehicles={[]}
        mockMode={false}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Feed status is unavailable');
    expect(html).not.toContain('Monitoring is stopped');
  });

  it('warns about stale diagnostics and shows shared cooldown pausing polling', () => {
    const data = {
      ...diagnostics,
      traffic: { ...diagnostics.traffic, cooldownUntil: '2026-10-05T01:05:00Z' },
    };
    const html = renderToStaticMarkup(
      <ApiConnectionsPanel
        diagnostics={data}
        loading={false}
        error
        vehicles={[]}
        mockMode={false}
      />,
    );
    expect(html).toContain('may be out of date');
    expect(html).toContain('Paused by rate-limit cooldown');
    expect(html).toContain('Paused until');
  });

  it('lists each topic by kind: read with its fields, unkept by name and size, quiet by its archive', () => {
    const client = new QueryClient();
    const latest: FeedLatestData = {
      feedId: 'parallax:v1:security',
      messages: [
        {
          topic: 'security.alarm.state',
          receivedAt: '2026-10-05T01:00:00Z',
          fields: [{ path: '1', name: null, value: '2' }],
        },
        {
          topic: 'security.access.passive_entry',
          receivedAt: '2026-10-05T01:00:00Z',
          count: 3,
          bytes: 2,
        },
      ],
      lastArchivedAt: {
        'security.video_monitoring.state': '2026-09-03T10:00:00Z',
        'security.access.immobilizer_state': null,
      },
    };
    client.setQueryData(['feedLatest', latest.feedId], latest);
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <FeedLatestBody
          feedId={latest.feedId}
          topics={[
            { rvm: 'security.alarm.state', kind: 'probe' },
            { rvm: 'security.access.passive_entry', kind: 'unregistered' },
            { rvm: 'security.video_monitoring.state', kind: 'probe' },
            { rvm: 'security.access.immobilizer_state', kind: 'probe' },
          ]}
        />
      </QueryClientProvider>,
    );
    expect(html).toContain('Probe');
    expect(html).toContain('Not kept');
    expect(html).toContain('3 messages, 2 bytes');
    expect(html).toContain('last archived');
    expect(html).toContain('never archived');
    // An unkept topic has no fields to show.
    expect(html.match(/<table/g)).toHaveLength(1);
  });
});
