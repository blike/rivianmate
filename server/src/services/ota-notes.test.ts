import { describe, expect, it } from "vitest";
import { downloadPdf, notesToDownload, reportedVersions, safeUrl } from "./ota-notes.js";

const v = (value: string) => ({ timeStamp: "t", value });
const notes = (version: string, url = `https://docs.example/${version}.pdf`) => ({
  url,
  version,
  locale: "en-US",
});

describe("reportedVersions", () => {
  it("lists the installed and pending versions once each", () => {
    expect(reportedVersions({ otaCurrentVersion: v("2026.31.0"), otaAvailableVersion: v("2026.36.0") })).toEqual([
      "2026.31.0",
      "2026.36.0",
    ]);
    expect(reportedVersions({ otaCurrentVersion: v("2026.31.0"), otaAvailableVersion: v("0.0.0") })).toEqual(["2026.31.0"]);
    expect(reportedVersions({ otaCurrentVersion: v("2026.31.0"), otaAvailableVersion: v("2026.31.0") })).toEqual(["2026.31.0"]);
    expect(reportedVersions({})).toEqual([]);
  });
});

describe("notesToDownload", () => {
  const details = { current: notes("2026.31.0"), available: notes("2026.36.0") };

  it("skips versions already stored", () => {
    expect(notesToDownload(details, new Set(["2026.31.0"]))).toEqual([
      { version: "2026.36.0", url: "https://docs.example/2026.36.0.pdf" },
    ]);
    expect(notesToDownload(details, new Set(["2026.31.0", "2026.36.0"]))).toEqual([]);
  });

  it("skips missing or unsafe links", () => {
    expect(notesToDownload({ current: notes("1", "http://x/1.pdf"), available: null }, new Set())).toEqual([]);
    expect(notesToDownload({ current: { url: null, version: "1", locale: null }, available: null }, new Set())).toEqual([]);
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

describe("downloadPdf", () => {
  const respond = (body: string, init?: ResponseInit) => (async () => new Response(body, init)) as typeof fetch;

  it("returns the PDF bytes", async () => {
    const pdf = await downloadPdf("https://x", respond("%PDF-1.7 notes"));
    expect(pdf?.toString()).toBe("%PDF-1.7 notes");
  });

  it("rejects non-PDFs and failed downloads", async () => {
    expect(await downloadPdf("https://x", respond("<html>expired</html>"))).toBeNull();
    await expect(downloadPdf("https://x", respond("denied", { status: 403 }))).rejects.toThrow("HTTP 403");
  });
});
