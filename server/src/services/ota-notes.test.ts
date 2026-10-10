import { describe, expect, it, vi } from "vitest";
import type { RivianApi } from "../rivian/client.js";
import { RivianApiError } from "../rivian/types.js";
import { OtaNotesResolver, notesUrlFor, safeUrl } from "./ota-notes.js";

const notes = (version: string, url = `https://docs.example/${version}.pdf`) => ({
  url,
  version,
  locale: "en-US",
});

describe("notesUrlFor", () => {
  const details = { current: notes("2026.31.0"), available: notes("2026.36.0") };

  it("matches the installed or pending version", () => {
    expect(notesUrlFor(details, "2026.31.0")).toBe("https://docs.example/2026.31.0.pdf");
    expect(notesUrlFor(details, "2026.36.0")).toBe("https://docs.example/2026.36.0.pdf");
  });

  it("returns null for other versions or unsafe links", () => {
    expect(notesUrlFor(details, "2026.22.0")).toBeNull();
    expect(notesUrlFor({ current: notes("1", "http://x/1"), available: null }, "1")).toBeNull();
    expect(notesUrlFor({ current: null, available: null }, "1")).toBeNull();
  });
});

describe("safeUrl", () => {
  it("only allows https links", () => {
    expect(safeUrl("https://rivian.com/notes")).toBe("https://rivian.com/notes");
    expect(safeUrl("http://rivian.com/notes")).toBeNull();
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});

describe("OtaNotesResolver", () => {
  const api = (impl: () => Promise<unknown>) =>
    ({ getOtaUpdateDetails: vi.fn(impl) }) as unknown as RivianApi & {
      getOtaUpdateDetails: ReturnType<typeof vi.fn>;
    };

  it("reuses one fetch for both versions", async () => {
    const a = api(async () => ({ current: notes("1.0"), available: notes("2.0") }));
    const resolver = new OtaNotesResolver(a);
    expect(await resolver.notesUrl("v", "1.0")).toBe("https://docs.example/1.0.pdf");
    expect(await resolver.notesUrl("v", "2.0")).toBe("https://docs.example/2.0.pdf");
    expect(a.getOtaUpdateDetails).toHaveBeenCalledTimes(1);
  });

  it("retries after a failure", async () => {
    let calls = 0;
    const a = api(async () => {
      if (calls++ === 0) throw new Error("network");
      return { current: notes("1.0"), available: null };
    });
    const resolver = new OtaNotesResolver(a);
    expect(await resolver.notesUrl("v", "1.0")).toBeNull();
    expect(await resolver.notesUrl("v", "1.0")).toBe("https://docs.example/1.0.pdf");
  });

  it("stops asking once Rivian rejects the query", async () => {
    const a = api(async () => {
      throw new RivianApiError("Validation error", "GRAPHQL_VALIDATION_FAILED");
    });
    const resolver = new OtaNotesResolver(a);
    expect(await resolver.notesUrl("v", "1.0")).toBeNull();
    expect(await resolver.notesUrl("v", "1.0")).toBeNull();
    expect(a.getOtaUpdateDetails).toHaveBeenCalledTimes(1);
  });
});
