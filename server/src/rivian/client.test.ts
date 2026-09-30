import { afterEach, describe, expect, it, vi } from "vitest";
import { RivianClient } from "./client.js";
import { RivianGovernor } from "./governor.js";
import {
  RivianCooldownError,
  RivianRateLimitError,
  RivianUnauthenticatedError,
} from "./types.js";

type Handler = (op: string, headers: Record<string, string>) => Response;

function stubFetch(handler: Handler) {
  const calls: { op: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const op = (JSON.parse(init.body as string) as { operationName: string })
        .operationName;
      const headers = init.headers as Record<string, string>;
      calls.push({ op, headers });
      return handler(op, headers);
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

let csrfCounter = 0;
const csrf = () =>
  json({
    data: {
      createCsrfToken: {
        csrfToken: `csrf-${++csrfCounter}`,
        appSessionToken: `asess-${csrfCounter}`,
      },
    },
  });

const tokens = { accessToken: "access", refreshToken: "refresh", userSessionToken: "usess" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RivianClient", () => {
  it("sends the full authenticated header set", async () => {
    const calls = stubFetch((op) =>
      op === "CreateCSRFToken" ? csrf() : json({ data: { currentUser: { id: "u", vehicles: [] } } }),
    );
    const client = new RivianClient({ tokens, governor: new RivianGovernor({ minSpacingMs: 0 }) });
    await client.getUserInfo();
    const headers = calls.find((c) => c.op === "getUserInfo")!.headers;
    expect(headers["U-Sess"]).toBe("usess");
    expect(headers["A-Sess"]).toMatch(/^asess-/);
    expect(headers["Csrf-Token"]).toMatch(/^csrf-/);
    expect(headers.Authorization).toBe("Bearer access");
  });

  it("rotates the session once on UNAUTHENTICATED and retries", async () => {
    let userInfoCalls = 0;
    const calls = stubFetch((op) => {
      if (op === "CreateCSRFToken") return csrf();
      userInfoCalls += 1;
      return userInfoCalls === 1
        ? json({ errors: [{ message: "expired", extensions: { code: "UNAUTHENTICATED" } }] })
        : json({ data: { currentUser: { id: "u", vehicles: [] } } });
    });
    const client = new RivianClient({ tokens, governor: new RivianGovernor({ minSpacingMs: 0 }) });
    await expect(client.getUserInfo()).resolves.toEqual({ id: "u", vehicles: [] });
    expect(calls.filter((c) => c.op === "CreateCSRFToken")).toHaveLength(2);
  });

  it("gives up after one rotation if still unauthenticated", async () => {
    stubFetch((op) =>
      op === "CreateCSRFToken"
        ? csrf()
        : json({ errors: [{ message: "no", extensions: { code: "UNAUTHENTICATED" } }] }),
    );
    const client = new RivianClient({ tokens, governor: new RivianGovernor({ minSpacingMs: 0 }) });
    await expect(client.getUserInfo()).rejects.toBeInstanceOf(RivianUnauthenticatedError);
  });

  it("treats HTTP 429 as a rate limit and starts a cooldown", async () => {
    stubFetch((op) =>
      op === "CreateCSRFToken" ? csrf() : json({}, 429, { "retry-after": "1800" }),
    );
    const governor = new RivianGovernor({ minSpacingMs: 0 });
    const client = new RivianClient({ tokens, governor });
    const err = await client.getUserInfo().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RivianRateLimitError);
    expect((err as RivianRateLimitError).retryAfterMs).toBe(1_800_000);
    expect(governor.cooldownRemainingMs()).toBeGreaterThan(1_700_000);
    expect(governor.snapshot().last24h.rateLimited).toBe(1);
  });

  it("does not contact Rivian or extend the cooldown while paused", async () => {
    const calls = stubFetch((op) =>
      op === "CreateCSRFToken" ? csrf() : json({}, 429),
    );
    const governor = new RivianGovernor({ minSpacingMs: 0 });
    const client = new RivianClient({ tokens, governor });
    await client.getUserInfo().catch(() => {});
    const sent = calls.length;
    const until = governor.snapshot().cooldownUntil;
    await expect(client.getUserInfo()).rejects.toBeInstanceOf(RivianCooldownError);
    expect(calls).toHaveLength(sent);
    expect(governor.snapshot().cooldownUntil).toBe(until);
    expect(governor.snapshot().last24h.rateLimited).toBe(1);
  });

  it("shares one rotation between concurrent callers", async () => {
    const calls = stubFetch(() => csrf());
    const client = new RivianClient({ tokens, governor: new RivianGovernor({ minSpacingMs: 0 }) });
    await Promise.all([client.refreshSession(), client.refreshSession()]);
    expect(calls).toHaveLength(1);
  });
});
