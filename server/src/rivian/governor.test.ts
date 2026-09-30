import { describe, expect, it } from "vitest";
import { RivianGovernor, parseRetryAfter } from "./governor.js";
import { RivianCooldownError } from "./types.js";

function fakeClock() {
  let t = 1_700_000_000_000;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("RivianGovernor", () => {
  it("spaces consecutive requests apart", async () => {
    const clock = fakeClock();
    const gov = new RivianGovernor({ minSpacingMs: 2_000, ...clock });
    const starts: number[] = [];
    await Promise.all(
      [1, 2, 3].map(() =>
        gov.schedule("op", async () => {
          starts.push(clock.now());
        }),
      ),
    );
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(2_000);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(2_000);
  });

  it("fails fast during a rate-limit cooldown and escalates it", async () => {
    const clock = fakeClock();
    const gov = new RivianGovernor({ minSpacingMs: 0, ...clock });
    expect(gov.noteRateLimited()).toBe(5 * 60_000);
    expect(gov.cooldownRemainingMs()).toBe(5 * 60_000);

    let ran = false;
    await expect(
      gov.schedule("op", async () => {
        ran = true;
      }),
    ).rejects.toBeInstanceOf(RivianCooldownError);
    expect(ran).toBe(false);

    clock.advance(5 * 60_000);
    await expect(gov.schedule("op", async () => 1)).resolves.toBe(1);

    expect(gov.noteRateLimited()).toBe(10 * 60_000);
    gov.noteSuccess();
    clock.advance(60 * 60_000);
    expect(gov.noteRateLimited()).toBe(5 * 60_000);
  });

  it("honors a longer Retry-After and caps escalation at an hour", () => {
    const clock = fakeClock();
    const gov = new RivianGovernor(clock);
    expect(gov.noteRateLimited(20 * 60_000)).toBe(20 * 60_000);
    for (let i = 0; i < 10; i++) gov.noteRateLimited();
    expect(gov.noteRateLimited()).toBe(60 * 60_000);
  });

  it("counts requests per operation over a rolling 24h window", async () => {
    const clock = fakeClock();
    const gov = new RivianGovernor({ minSpacingMs: 0, ...clock });
    await gov.schedule("GetVehicleState", async () => {});
    await gov.schedule("GetVehicleState", async () => {});
    await gov.schedule("getUserInfo", async () => {});
    gov.count("wsConnects");

    let snap = gov.snapshot();
    expect(snap.last24h.httpRequests).toBe(3);
    expect(snap.last24h.wsConnects).toBe(1);
    expect(snap.requestsByOperation24h).toEqual({
      GetVehicleState: 2,
      getUserInfo: 1,
    });

    clock.advance(25 * 60 * 60_000);
    snap = gov.snapshot();
    expect(snap.last24h.httpRequests).toBe(0);
    expect(snap.requestsByOperation24h).toEqual({});
  });

  it("keeps the queue moving when a request fails", async () => {
    const clock = fakeClock();
    const gov = new RivianGovernor({ minSpacingMs: 0, ...clock });
    await expect(
      gov.schedule("op", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(gov.schedule("op", async () => 42)).resolves.toBe(42);
  });
});

describe("parseRetryAfter", () => {
  it("parses seconds and HTTP dates", () => {
    expect(parseRetryAfter("120")).toBe(120_000);
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:01:00 GMT", now)).toBe(60_000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});
