import { describe, expect, it, vi } from "vitest";
import { channelUrlProblem, payload, previewUrl, sendAlert } from "./notify-channels.js";

const alert = { title: "Driver door left open", body: "Driver door on R1S has been open for 5 minutes.", level: "warning" as const };

describe("channelUrlProblem", () => {
  it("accepts Apprise http(s) URLs", () => {
    expect(channelUrlProblem("apprise", "http://apprise:8000/notify/rivianmate")).toBeNull();
    expect(channelUrlProblem("apprise", "ftp://x")).not.toBeNull();
    expect(channelUrlProblem("apprise", "nope")).toBe("Not a valid URL");
  });

  it("only accepts Discord webhook URLs for Discord", () => {
    expect(channelUrlProblem("discord", "https://discord.com/api/webhooks/1/abc")).toBeNull();
    expect(channelUrlProblem("discord", "https://discordapp.com/api/webhooks/1/abc")).toBeNull();
    expect(channelUrlProblem("discord", "http://discord.com/api/webhooks/1/abc")).not.toBeNull();
    expect(channelUrlProblem("discord", "https://evil.example/api/webhooks/1/abc")).not.toBeNull();
  });
});

describe("previewUrl", () => {
  it("hides everything past the start of the path", () => {
    expect(previewUrl("https://discord.com/api/webhooks/123/secret-token")).toBe("discord.com/api/webhooks/…");
    expect(previewUrl("http://apprise:8000/notify/rivianmate")).toBe("apprise:8000/notify/rivianmate");
  });
});

describe("payload / sendAlert", () => {
  it("formats for each service", () => {
    expect(payload("apprise", alert)).toEqual({ title: alert.title, body: alert.body, type: "warning" });
    expect(payload("discord", alert)).toMatchObject({ username: "RivianMate", embeds: [{ title: alert.title, color: 0xfab219 }] });
  });

  it("lays out fields and links", () => {
    const rich = {
      ...alert,
      url: "https://rm.example/notes",
      fields: [
        { name: "Version", value: "2026.36.0", inline: true },
        { name: "Release notes", value: "View 2026.36.0 notes", url: "https://rm.example/notes" },
      ],
    };
    expect(payload("discord", rich)).toMatchObject({
      allowed_mentions: { parse: [] },
      embeds: [
        {
          url: "https://rm.example/notes",
          description: alert.body,
          fields: [
            { name: "Version", value: "2026.36.0", inline: true },
            { name: "Release notes", value: "[View 2026.36.0 notes](https://rm.example/notes)", inline: false },
          ],
        },
      ],
    });
    expect(payload("apprise", rich)).toMatchObject({
      body: `${alert.body}\n\nVersion: 2026.36.0\nRelease notes: https://rm.example/notes`,
    });
  });

  it("posts JSON and reports failures", async () => {
    const ok = vi.fn(async () => new Response(null, { status: 204 }));
    await sendAlert("discord", "https://discord.com/api/webhooks/1/a", alert, ok as unknown as typeof fetch);
    expect(ok).toHaveBeenCalledWith("https://discord.com/api/webhooks/1/a", expect.objectContaining({ method: "POST" }));
    const bad = (async () => new Response("Unknown Webhook", { status: 404 })) as typeof fetch;
    await expect(sendAlert("discord", "https://discord.com/api/webhooks/1/a", alert, bad)).rejects.toThrow("HTTP 404: Unknown Webhook");
  });
});
