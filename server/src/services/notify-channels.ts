/** Where alerts go: an Apprise API server or a Discord webhook. */

export type AlertLevel = "info" | "success" | "warning" | "failure";

/** A labelled fact; Discord lays inline ones out in columns. */
export interface AlertField {
  name: string;
  value: string;
  inline?: boolean;
  /** Makes the value a link. */
  url?: string;
}

export interface Alert {
  title: string;
  body: string;
  level: AlertLevel;
  /** Where the title links to, e.g. release notes. */
  url?: string;
  fields?: AlertField[];
}

export type ChannelKind = "apprise" | "discord";

const TIMEOUT_MS = 10_000;

const DISCORD_COLOR: Record<AlertLevel, number> = {
  info: 0x3987e5,
  success: 0x0ca30c,
  warning: 0xfab219,
  failure: 0xd03b3b,
};

/** http(s) URLs only; Discord webhooks must be Discord's own https endpoints. */
export function channelUrlProblem(kind: ChannelKind, url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Not a valid URL";
  }
  if (kind === "apprise") {
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? null : "Use an http(s) URL";
  }
  const discordHost = /^(?:canary\.|ptb\.)?discord(?:app)?\.com$/.test(parsed.hostname);
  return parsed.protocol === "https:" && discordHost && parsed.pathname.startsWith("/api/webhooks/")
    ? null
    : "Use a Discord webhook URL (https://discord.com/api/webhooks/…)";
}

/** Host and the start of the path, with anything secret-looking cut off. */
export function previewUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const shown = parts.slice(0, 2).join("/");
    return `${u.host}/${shown}${parts.length > 2 ? "/…" : ""}`;
  } catch {
    return "…";
  }
}

/** The request body each service expects. */
export function payload(kind: ChannelKind, alert: Alert): unknown {
  const fields = alert.fields ?? [];
  if (kind === "apprise") {
    // Plain text: one "Name: value" line per field, links as bare URLs.
    const lines = fields.map((f) => `${f.name}: ${f.url ?? f.value}`);
    const body = lines.length ? `${alert.body}\n\n${lines.join("\n")}` : alert.body;
    return { title: alert.title, body, type: alert.level };
  }
  return {
    username: "RivianMate",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: alert.title,
        ...(alert.url ? { url: alert.url } : {}),
        description: alert.body,
        color: DISCORD_COLOR[alert.level],
        ...(fields.length
          ? {
              fields: fields.map((f) => ({
                name: f.name,
                value: f.url ? `[${f.value}](${f.url})` : f.value,
                inline: f.inline ?? false,
              })),
            }
          : {}),
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export async function sendAlert(
  kind: ChannelKind,
  url: string,
  alert: Alert,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload(kind, alert)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
}
