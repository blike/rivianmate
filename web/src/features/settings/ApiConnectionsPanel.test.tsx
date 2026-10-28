import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FeedTopic, RivianDiagnosticsResponse } from '../../api/client';
import { ApiConnectionsPanel, TopicDetail, matchesFilter } from './ApiConnectionsPanel';

const topic = (rvm: string, kind: FeedTopic['kind'], lastMessageAt: string | null = null) => ({
  rvm,
  kind,
  lastMessageAt,
  count: lastMessageAt ? 3 : 0,
});

const diagnostics: RivianDiagnosticsResponse = {
  monitor: {
    running: true,
    streamConnected: true,
    fallbackPolling: false,
    pollingStatus: 'standby',
    consecutiveAuthFailures: 0,
    parallaxMode: 'classic',
    parallaxModes: {},
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
          topics: [topic('energy.high_voltage.battery_state', 'read')],
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

const render = (data: RivianDiagnosticsResponse | undefined, error = false) =>
  renderToStaticMarkup(
    <ApiConnectionsPanel
      diagnostics={data}
      loading={false}
      error={error}
      vehicles={[]}
      mockMode={false}
    />,
  );

type Feeds = NonNullable<RivianDiagnosticsResponse['monitor']['subscriptions']>['feeds'];

const withFeeds = (feeds: Feeds): RivianDiagnosticsResponse => ({
  ...diagnostics,
  monitor: {
    ...diagnostics.monitor,
    subscriptions: { ...diagnostics.monitor.subscriptions!, feeds },
  },
});

describe('API connections', () => {
  it('shows the stream’s health under the headline, and each feed by API', () => {
    const html = render(diagnostics);
    for (const text of [
      'Streaming from Rivian',
      'Live stream',
      'Dropped connections',
      'Fallback polling',
      'Live stream connected',
      'Last request',
      'aria-label="Legacy feeds"',
      'aria-label="Parallax feeds"',
      'Vehicle state',
      'Receiving',
      'Waiting',
      'Unsupported',
      '0 of 1 domains receiving',
    ])
      expect(html).toContain(text);
    expect(html).not.toContain('Monitoring is stopped');
    expect(html).not.toContain('Requests');
  });

  it('explains every feed status and topic label once, under the feeds', () => {
    const html = render(diagnostics);
    const key = html.indexOf('aria-label="Legend"');
    expect(key).toBeGreaterThan(html.indexOf('aria-label="Parallax feeds"'));
    expect(html).not.toContain('<details class="card group"><summary');
    for (const text of [
      'Rivian accepted the subscription but only sends empty readings',
      'Rivian declined the subscription',
      'Archived to be worked out',
      'never stored',
      'haven’t arrived since the server started',
    ])
      expect(html).toContain(text);
  });

  it('names Parallax domains, and counts each kind of topic', () => {
    const feeds = diagnostics.monitor.subscriptions!.feeds;
    const at = '2026-10-05T01:00:00Z';
    const html = render(
      withFeeds([
        {
          ...feeds[1]!,
          id: 'o',
          domain: 'ota',
          topics: [
            topic('ota.deployment.state', 'read', at),
            topic('ota.user_schedule.ota_config', 'probe'),
          ],
        },
        {
          ...feeds[1]!,
          id: 'd',
          domain: 'device_table',
          topics: [topic('device_table.vas_keyper.devices', 'unregistered', at)],
        },
      ]),
    );
    expect(html).toContain('>OTA<');
    expect(html).toContain('>Devices<');
    const chip = (label: string) =>
      html.match(new RegExp(`>${label} <span[^>]*>(\\d+)</span>`))?.[1];
    expect(chip('All')).toBe('3');
    expect(chip('Read')).toBe('1');
    expect(chip('Probe')).toBe('1');
    expect(chip('Not kept')).toBe('1');
    expect(chip('Quiet')).toBe('1');
  });

  it('filters topics by kind, and quiet ones that are known but haven’t come', () => {
    const at = '2026-10-05T01:00:00Z';
    expect(matchesFilter(topic('a.b', 'read', at), 'read')).toBe(true);
    expect(matchesFilter(topic('a.b', 'read', at), 'quiet')).toBe(false);
    expect(matchesFilter(topic('a.b', 'probe'), 'quiet')).toBe(true);
    // A topic not kept only shows once it has come, so it's never quiet.
    expect(matchesFilter(topic('a.b', 'unregistered'), 'quiet')).toBe(false);
    expect(matchesFilter(topic('a.b', 'unregistered', at), 'all')).toBe(true);
  });

  it('shows what a topic last sent, how often one not kept came, and when a quiet one changed', () => {
    const at = '2026-10-05T01:00:00Z';
    const fields = renderToStaticMarkup(
      <TopicDetail
        topic={topic('security.alarm.state', 'probe', at)}
        message={{ topic: 'security.alarm.state', receivedAt: at, fields: [] }}
        archived={undefined}
      />,
    );
    expect(fields).toContain('3 messages since the server started');
    expect(fields).toContain('every field is zero');

    const notKept = renderToStaticMarkup(
      <TopicDetail
        topic={topic('security.access.passive_entry', 'unregistered', at)}
        message={{ topic: 'security.access.passive_entry', receivedAt: at, count: 3, bytes: 2 }}
        archived={undefined}
      />,
    );
    expect(notKept).toContain('Seen 3 times, 2 bytes last');
    expect(notKept).toContain('never kept');

    const changed = renderToStaticMarkup(
      <TopicDetail
        topic={topic('security.video_monitoring.state', 'probe')}
        message={undefined}
        archived="2026-09-03T10:00:00Z"
      />,
    );
    expect(changed).toContain('Last changed');
    const never = renderToStaticMarkup(
      <TopicDetail
        topic={topic('security.access.immobilizer_state', 'probe')}
        message={undefined}
        archived={null}
      />,
    );
    expect(never).toContain('Never archived');
  });

  it('does not present a failed diagnostics request as a stopped monitor', () => {
    const html = render(undefined, true);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Feed status is unavailable');
    expect(html).not.toContain('Monitoring is stopped');
  });

  it('warns about stale diagnostics and shows shared cooldown pausing polling', () => {
    const html = render(
      {
        ...diagnostics,
        traffic: { ...diagnostics.traffic, cooldownUntil: '2026-10-05T01:05:00Z' },
      },
      true,
    );
    expect(html).toContain('may be out of date');
    expect(html).toContain('By rate-limit cooldown');
    expect(html).toContain('Paused until');
  });
});
