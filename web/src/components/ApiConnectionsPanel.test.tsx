import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RivianDiagnosticsResponse } from "../api/client.js";
import { ApiConnectionsPanel } from "./ApiConnectionsPanel.js";

const diagnostics: RivianDiagnosticsResponse = {
  monitor: {
    running: true, streamConnected: true, fallbackPolling: false, pollingStatus: "standby",
    consecutiveAuthFailures: 0, parallaxMode: "classic", parallaxModes: {}, parallaxDroppedFields: [],
    subscriptions: {
      state: "connected", lastMessageAt: "2026-10-05T01:00:00Z",
      feeds: [
        { id: "v", vehicleId: "v1", kind: "vehicleState", domain: null, topics: [], status: "receiving", lastMessageAt: "2026-10-05T01:00:00Z" },
        { id: "p", vehicleId: "v1", kind: "parallax", domain: "energy", topics: ["energy.high_voltage.battery_state"], status: "unsupported", lastMessageAt: null },
        { id: "c", vehicleId: "v1", kind: "chargingSession", domain: null, topics: [], status: "waiting", lastMessageAt: null },
      ],
    },
  },
  traffic: {
    since: "2026-10-05T00:00:00Z", lastSuccessfulRequestAt: "2026-10-05T01:00:00Z",
    cooldownUntil: null, lastRateLimitedAt: null, requestsByOperation24h: {},
    last24h: { httpRequests: 1, httpErrors: 0, rateLimited: 0, sessionRefreshes: 0, wsConnects: 1, wsReconnects: 2, wsMessages: 3, wsAuthFailures: 0 },
  },
};

describe("API connections", () => {
  it("shows independent feed statuses and request, polling, and socket health", () => {
    const html = renderToStaticMarkup(<ApiConnectionsPanel diagnostics={diagnostics} loading={false} error={false} vehicles={[]} mockMode={false} />);
    for (const text of ["Last successful request", "Standby", "connected", "Reconnect attempts", "receiving", "unsupported", "waiting", "Last data:", 'aria-label="Legacy feeds"', 'aria-label="Parallax feeds"', "energy.high_voltage.battery_state"]) expect(html).toContain(text);
    expect(html).not.toContain("Monitoring is stopped");
  });

  it("does not present a failed diagnostics request as a stopped monitor", () => {
    const html = renderToStaticMarkup(<ApiConnectionsPanel diagnostics={undefined} loading={false} error vehicles={[]} mockMode={false} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Feed status is unavailable");
    expect(html).not.toContain("Monitoring is stopped");
  });

  it("warns about stale diagnostics and shows shared cooldown pausing polling", () => {
    const data = { ...diagnostics, traffic: { ...diagnostics.traffic, cooldownUntil: "2026-10-05T01:05:00Z" } };
    const html = renderToStaticMarkup(<ApiConnectionsPanel diagnostics={data} loading={false} error vehicles={[]} mockMode={false} />);
    expect(html).toContain("may be out of date");
    expect(html).toContain("Paused by rate-limit cooldown");
    expect(html).toContain("Paused until");
  });
});
