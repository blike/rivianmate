import type {
  NotificationChannelKind,
  NotificationDestinationDto,
  NotificationDestinationUpdate,
  NotificationEvents,
  NotificationSettingsDto,
  NotificationSettingsUpdate,
  NotificationTestResult,
  TimedAlertSettings,
} from "@server/api-types.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { channelUrlProblem } from "@server/services/notify-channels.js";
import { ApiError, api } from "../api/client.js";
import { useNotificationSettings, useSetNotificationSettings, useTestNotifications } from "../api/hooks.js";
import { SkeletonRows } from "./loading.js";
import { SettingsGroup, Switch } from "./settings.js";

type Toggle = { enabled: boolean };
type ToggleKey = { [K in keyof NotificationEvents]: NotificationEvents[K] extends TimedAlertSettings ? never : K }[keyof NotificationEvents];
type TimedKey = "doorOpen" | "windowOpen" | "unlocked";

/** Saves this long after the last edit, so typing doesn't send every keystroke. */
const AUTOSAVE_MS = 500;

/** Apprise and Discord alerts for vehicle events. Changes save as they're made. */
export function NotificationsPanel() {
  const { data: settings, isPending } = useNotificationSettings();
  if (isPending || !settings) {
    return (
      <section className="card p-4">
        <SkeletonRows rows={6} />
      </section>
    );
  }
  return <NotificationsForm settings={settings} />;
}

function NotificationsForm(props: { settings: NotificationSettingsDto }) {
  const { settings } = props;
  const save = useSetNotificationSettings();
  const { mutate, isPending: saving } = save;
  const test = useTestNotifications();

  // The form owns the values once loaded; the server's copy only follows it.
  const [enabled, setEnabled] = useState(settings.enabled);
  const [events, setEvents] = useState(settings.events);
  const [destinations, setDestinations] = useState(() => settings.destinations.map(fromSaved));
  // Saved only on Save (or Enter), not per keystroke; suggests this page's address.
  const [appUrl, setAppUrl] = useState(settings.appUrl ?? "");
  const [appUrlDraft, setAppUrlDraft] = useState(settings.appUrl ?? window.location.origin);
  const appUrlError = appUrlProblem(appUrlDraft);
  const appUrlChanged = appUrlDraft.trim() !== appUrl.trim();
  const commitAppUrl = () => {
    if (appUrlChanged && !appUrlError) setAppUrl(appUrlDraft.trim());
  };

  const update: NotificationSettingsUpdate = {
    enabled,
    events,
    destinations: destinations.map(toUpdate),
    appUrl: appUrl.trim() || null,
  };
  const key = JSON.stringify(update);
  const [savedKey, setSavedKey] = useState(key);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const invalidUrl = destinations.some((d) => destinationProblem(d) !== null);
  const invalidMinutes = (["doorOpen", "windowOpen", "unlocked"] as const).some(
    (k) => !(events[k].minutes >= 1 && events[k].minutes <= 1440),
  );
  const invalidPercent = !(events.lowBattery.percent >= 1 && events.lowBattery.percent <= 90);
  const valid = !invalidUrl && !invalidMinutes && !invalidPercent;
  const dirty = key !== savedKey;
  const failed = failedKey === key;
  // The test goes to the saved destinations, so it waits only while a change
  // to them is on its way; other settings and edits that can't save yet don't count.
  const destinationsPending =
    valid &&
    !failed &&
    JSON.stringify(update.destinations) !==
      JSON.stringify((JSON.parse(savedKey) as NotificationSettingsUpdate).destinations);

  // Anything still unsaved when the page is left is sent on the way out.
  const unsaved = useRef<NotificationSettingsUpdate | null>(null);
  const pending = dirty && valid && !failed ? key : null;
  useEffect(() => {
    unsaved.current = pending ? (JSON.parse(pending) as NotificationSettingsUpdate) : null;
  }, [pending]);
  useEffect(
    () => () => {
      if (unsaved.current) void api.setNotificationSettings(unsaved.current);
    },
    [],
  );

  useEffect(() => {
    if (!dirty || !valid || failed || saving) return;
    const timer = setTimeout(() => {
      const sent = JSON.parse(key) as NotificationSettingsUpdate;
      mutate(sent, {
        onSuccess: (result) => {
          setSavedKey(key);
          setFailedKey(null);
          setJustSaved(true);
          // New destinations get the ids the server gave them, so later
          // saves keep them instead of adding them again.
          const known = new Set(sent.destinations.flatMap((d) => (d.id ? [d.id] : [])));
          const created = result.destinations.filter((d) => !known.has(d.id));
          if (created.length > 0) {
            setDestinations((list) => {
              const queue = [...created];
              return list.map((d) => {
                if (d.id || queue[0]?.kind !== d.kind) return d;
                const saved = queue.shift()!;
                return { ...d, id: saved.id, preview: saved.preview };
              });
            });
          }
        },
        onError: () => setFailedKey(key),
      });
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [key, dirty, valid, failed, saving, mutate]);

  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [justSaved]);

  const setEvent = <K extends keyof NotificationEvents>(key: K, value: NotificationEvents[K]) =>
    setEvents((all) => ({ ...all, [key]: value }));

  const timedProps = (key: TimedKey) => ({
    value: events[key],
    onChange: (value: TimedAlertSettings) => setEvent(key, value),
    homeKnown: settings.homeKnown,
  });
  const toggleProps = (key: ToggleKey) => ({
    checked: (events[key] as Toggle).enabled,
    onChange: (on: boolean) => setEvent(key, { ...events[key], enabled: on }),
  });

  const status = failed ? (
    <span className="text-[var(--status-critical)]" role="alert">
      {save.error instanceof ApiError ? save.error.message : "Couldn't save"}
    </span>
  ) : invalidMinutes ? (
    <span className="text-[var(--status-critical)]">Use 1 to 1440 minutes</span>
  ) : invalidPercent ? (
    <span className="text-[var(--status-critical)]">Use 1 to 90%</span>

  ) : dirty && valid ? (
    <span className="text-[var(--text-muted)]">Saving…</span>
  ) : justSaved ? (
    <span className="text-[var(--text-muted)]">Saved</span>
  ) : null;

  const destinationCount = destinations.filter((d) => d.id).length;
  const alertsOn = Object.values(events).filter((e) => e.enabled).length;
  const summary = !enabled
    ? "Get alerts in Discord, Pushover, ntfy, Telegram and more."
    : destinationCount === 0
      ? "Add a destination to start receiving alerts."
      : `${destinationCount} ${destinationCount === 1 ? "destination" : "destinations"} · ${alertsOn} of ${Object.keys(events).length} alerts on`;

  return (
    <>
      <section className="card flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <BellIcon on={enabled} />
          <div className="min-w-0">
            <h3 className="text-sm font-medium">Send notifications</h3>
            <p className="text-xs text-[var(--text-muted)]">{summary}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span aria-live="polite" className="text-xs">
            {status}
          </span>
          <Switch label="Send notifications" checked={enabled} onChange={setEnabled} />
        </div>
      </section>

      {/* Everything else stays hidden (but kept) while notifications are off. */}
      {enabled && (
        <>
          <SettingsGroup
            title="Destinations"
            action={
              destinations.some((d) => d.id) && (
                <span className="flex items-center gap-3">
                  {test.isError && <span className="text-xs text-[var(--status-critical)]">Couldn't send the test.</span>}
                  <button
                    className="text-xs text-[var(--text-secondary)] underline-offset-4 hover:text-[var(--text-primary)] hover:underline disabled:opacity-50"
                    disabled={destinationsPending || test.isPending}
                    onClick={() => test.mutate()}
                  >
                    {test.isPending ? "Sending…" : "Send test notification"}
                  </button>
                </span>
              )
            }
          >
            <Destinations
              destinations={destinations}
              onChange={setDestinations}
              results={destinationsPending ? undefined : test.data}
            />
          </SettingsGroup>

          <SettingsGroup title="Doors & locks">
            <TimedEvent title="Door left open" {...timedProps("doorOpen")} />
            <TimedEvent title="Window left open" {...timedProps("windowOpen")} />
            <TimedEvent title="Vehicle unlocked" {...timedProps("unlocked")} />
            {!settings.homeKnown && (["doorOpen", "windowOpen", "unlocked"] as const).some((k) => events[k].awayOnly) && (
              <p className="px-4 py-3 text-xs text-[var(--status-warning)]">
                No home location is set, so “not at home” alerts are always sent.{" "}
                <Link to="?section=charging" className="underline">
                  Set one in Charging
                </Link>
                .
              </p>
            )}
          </SettingsGroup>

          <SettingsGroup title="Software">
            <ToggleEvent title="Update available" detail="When a new version is offered" {...toggleProps("updateAvailable")} />
            <ToggleEvent title="Update installed" detail="When the vehicle finishes installing" {...toggleProps("updateInstalled")} />
            <ToggleEvent title="Update failed" detail="When an install doesn't succeed" {...toggleProps("updateFailed")} />
          </SettingsGroup>

          <SettingsGroup title="Battery, charging & tires">
            <ToggleEvent title="Charging complete" detail="When the charge limit is reached" {...toggleProps("chargingComplete")} />
            <EventRow
              title="Low battery"
              detail={
                <span className="inline-flex items-center gap-1.5">
                  Below
                  <NumberInput
                    label="Low battery percent"
                    value={events.lowBattery.percent}
                    min={1}
                    max={90}
                    onChange={(percent) => setEvent("lowBattery", { ...events.lowBattery, percent })}
                  />
                  %
                </span>
              }
              control={
                <Switch
                  label="Low battery"
                  checked={events.lowBattery.enabled}
                  onChange={(on) => setEvent("lowBattery", { ...events.lowBattery, enabled: on })}
                />
              }
            />
            <ToggleEvent title="Tire pressure" detail="When the vehicle flags a tire pressure issue" {...toggleProps("tirePressure")} />
          </SettingsGroup>

          <SettingsGroup
            title="Links in alerts"
            note={
              <span className={appUrlError ? "text-[var(--status-critical)]" : undefined}>
                {appUrlError ??
                  (isLocalAddress(appUrlDraft)
                    ? "Links to this address only work on this computer. Use one your phone can reach to open release notes from alerts."
                    : "Alerts link here, for example to release notes. Leave blank for no links.")}
              </span>
            }
          >
            <form
              className="flex items-center gap-2 px-4 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                commitAppUrl();
              }}
            >
              <label htmlFor="app-url" className="shrink-0 text-sm font-medium">
                RivianMate address
              </label>
              <input
                id="app-url"
                type="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://rivianmate.example.com"
                value={appUrlDraft}
                onChange={(e) => setAppUrlDraft(e.target.value)}
                aria-invalid={appUrlError != null}
                className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-sm"
              />
              {appUrlChanged && (
                <>
                  {appUrl && (
                    <button
                      type="button"
                      className="px-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      onClick={() => setAppUrlDraft(appUrl)}
                    >
                      Cancel
                    </button>
                  )}
                  <button type="submit" className="btn-primary" disabled={appUrlError != null}>
                    Save
                  </button>
                </>
              )}
            </form>
          </SettingsGroup>
        </>
      )}
    </>
  );
}

function EventRow(props: { title: string; detail?: ReactNode; control: ReactNode; extra?: ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">{props.title}</div>
          {props.detail && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{props.detail}</div>}
        </div>
        {props.control}
      </div>
      {props.extra}
    </div>
  );
}

function ToggleEvent(props: { title: string; detail: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <EventRow
      title={props.title}
      detail={props.detail}
      control={<Switch label={props.title} checked={props.checked} onChange={props.onChange} />}
    />
  );
}

function TimedEvent(props: {
  title: string;
  detail?: string;
  value: TimedAlertSettings;
  onChange: (value: TimedAlertSettings) => void;
  homeKnown: boolean;
}) {
  const { value } = props;
  return (
    <EventRow
      title={props.title}
      detail={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {props.detail && <span>{props.detail} ·</span>}
          After
          <NumberInput
            label={`${props.title} minutes`}
            value={value.minutes}
            min={1}
            max={1440}
            onChange={(minutes) => props.onChange({ ...value, minutes })}
          />
          min
        </span>
      }
      control={<Switch label={props.title} checked={value.enabled} onChange={(enabled) => props.onChange({ ...value, enabled })} />}
      extra={
        <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={value.awayOnly}
            onChange={(e) => props.onChange({ ...value, awayOnly: e.target.checked })}
          />
          Only when not at home
        </label>
      }
    />
  );
}

const MAX_DESTINATIONS = 10;

function appUrlProblem(url: string): string | null {
  if (!url.trim()) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? null : "Use an http(s) address";
  } catch {
    return "Enter a full address, like https://rivianmate.example.com";
  }
}

function isLocalAddress(url: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url.trim()).hostname);
  } catch {
    return false;
  }
}

/** A destination being edited; `url` is blank to keep a saved one's URL. */
interface DraftDestination {
  key: string;
  id?: string;
  kind: NotificationChannelKind;
  name: string;
  url: string;
  preview?: string;
  editing: boolean;
}

let draftKeys = 0;
/** crypto.randomUUID needs a secure context, which a LAN http address isn't. */
const newKey = () => `new-${++draftKeys}`;

const fromSaved = (d: NotificationDestinationDto): DraftDestination => ({
  key: d.id,
  id: d.id,
  kind: d.kind,
  name: d.name ?? "",
  url: "",
  preview: d.preview,
  editing: false,
});

const toUpdate = (d: DraftDestination): NotificationDestinationUpdate => ({
  ...(d.id ? { id: d.id } : {}),
  kind: d.kind,
  name: d.name.trim() || null,
  ...(d.url.trim() ? { url: d.url.trim() } : {}),
});

function destinationProblem(d: DraftDestination): string | null {
  const url = d.url.trim();
  if (!url) return d.id ? null : "Enter a URL";
  return channelUrlProblem(d.kind, url);
}

const CHANNELS: Record<
  NotificationChannelKind,
  { name: string; summary: string; placeholder: string; help: ReactNode; icon: ReactNode }
> = {
  discord: {
    name: "Discord",
    summary: "Post alerts to a Discord channel with a webhook.",
    placeholder: "https://discord.com/api/webhooks/…",
    help: "In Discord: Server settings → Integrations → Webhooks → New webhook → Copy webhook URL.",
    icon: <DiscordLogo />,
  },
  apprise: {
    name: "Apprise",
    summary: "Pushover, ntfy, Telegram, Slack, email and 100+ more through an Apprise API server.",
    placeholder: "http://apprise:8000/notify/rivianmate",
    help: (
      <>
        The notify URL of your{" "}
        <a className="underline hover:text-[var(--text-primary)]" href="https://github.com/caronc/apprise-api" target="_blank" rel="noreferrer noopener">
          Apprise API
        </a>{" "}
        server, including its config key.
      </>
    ),
    icon: <img src="/brands/apprise.png" alt="" className="h-8 w-8 shrink-0 rounded-full" />,
  },
};

/** Saved and new destinations, plus an "Add destination" picker. */
function Destinations(props: {
  destinations: DraftDestination[];
  onChange: (destinations: DraftDestination[]) => void;
  results?: NotificationTestResult[];
}) {
  const [picking, setPicking] = useState(false);
  const list = props.destinations;
  const update = (key: string, change: Partial<DraftDestination> | null) =>
    props.onChange(
      change === null ? list.filter((d) => d.key !== key) : list.map((d) => (d.key === key ? { ...d, ...change } : d)),
    );
  const add = (kind: NotificationChannelKind) => {
    props.onChange([...list, { key: newKey(), kind, name: "", url: "", editing: true }]);
    setPicking(false);
  };

  return (
    <>
      {list.length === 0 && !picking && (
        <p className="px-4 py-5 text-center text-sm text-[var(--text-muted)]">No destinations yet. Add one to start receiving alerts.</p>
      )}
      {list.map((d) => (
        <DestinationCard
          key={d.key}
          destination={d}
          result={d.id ? props.results?.find((r) => r.id === d.id) : undefined}
          onChange={(change) => update(d.key, change)}
          onRemove={() => update(d.key, null)}
        />
      ))}

      {picking ? (
        <div className="p-3">
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-xs text-[var(--text-muted)]">Choose a destination</span>
            <button className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={() => setPicking(false)}>
              Cancel
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(CHANNELS) as NotificationChannelKind[]).map((kind) => (
              <button
                key={kind}
                className="flex items-start gap-3 rounded-md bg-[var(--surface-2)] p-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--surface-2)_70%,var(--border))]"
                onClick={() => add(kind)}
              >
                {CHANNELS[kind].icon}
                <span>
                  <span className="block text-sm font-medium">{CHANNELS[kind].name}</span>
                  <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{CHANNELS[kind].summary}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        list.length < MAX_DESTINATIONS && (
          <button
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[var(--text-secondary)] transition-colors last:rounded-b-xl hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
            onClick={() => setPicking(true)}
          >
            <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full border border-dashed border-[var(--border)] text-base leading-none">
              +
            </span>
            Add destination
          </button>
        )
      )}
    </>
  );
}

function DestinationCard(props: {
  destination: DraftDestination;
  result?: NotificationTestResult;
  onChange: (change: Partial<DraftDestination>) => void;
  onRemove: () => void;
}) {
  const d = props.destination;
  const channel = CHANNELS[d.kind];
  const problem = d.url.trim() ? destinationProblem(d) : null;
  const ids = { name: `${d.key}-name`, url: `${d.key}-url` };
  const title = d.name.trim() || channel.name;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        {channel.icon}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {title}
            {d.name.trim() && <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">{channel.name}</span>}
          </div>
          {!d.editing && <div className="truncate font-mono text-xs text-[var(--text-secondary)]">{d.preview}</div>}
          {props.result && (
            <div
              className={`text-xs ${props.result.ok ? "text-[var(--status-good)]" : "text-[var(--status-critical)]"}`}
              title={props.result.error ?? undefined}
            >
              {props.result.ok ? "Test sent" : `Test failed${props.result.error ? `: ${props.result.error}` : ""}`}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-sm">
          {d.editing && d.id ? (
            <button
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              disabled={problem != null}
              onClick={() => props.onChange({ editing: false })}
            >
              Done
            </button>
          ) : (
            !d.editing && (
              <button className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={() => props.onChange({ editing: true })}>
                Edit
              </button>
            )
          )}
          <button className="text-[var(--text-secondary)] hover:text-[var(--status-critical)]" onClick={props.onRemove}>
            Remove
          </button>
        </div>
      </div>
      {d.editing && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <div>
            <label htmlFor={ids.name} className="mb-1 block text-xs text-[var(--text-muted)]">
              Name <span className="opacity-70">(optional)</span>
            </label>
            <input
              id={ids.name}
              maxLength={60}
              placeholder={channel.name}
              value={d.name}
              onChange={(e) => props.onChange({ name: e.target.value })}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor={ids.url} className="mb-1 block text-xs text-[var(--text-muted)]">
              {d.kind === "discord" ? "Webhook URL" : "Notify URL"}
            </label>
            <input
              id={ids.url}
              type="url"
              autoFocus={!d.id}
              autoComplete="off"
              spellCheck={false}
              placeholder={d.id ? "Leave blank to keep the current URL" : channel.placeholder}
              value={d.url}
              onChange={(e) => props.onChange({ url: e.target.value })}
              aria-invalid={problem != null}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-sm"
            />
          </div>
          <p className={`text-xs sm:col-span-2 ${problem ? "text-[var(--status-critical)]" : "text-[var(--text-muted)]"}`}>
            {problem ?? channel.help}
          </p>
        </div>
      )}
    </div>
  );
}

/** Discord's mark (Simple Icons, CC0) on Discord blurple. */
function DiscordLogo() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#5865F2]" aria-hidden>
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="#fff">
        <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
      </svg>
    </span>
  );
}

function NumberInput(props: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={props.label}
      min={props.min}
      max={props.max}
      value={Number.isFinite(props.value) ? props.value : ""}
      onChange={(e) => props.onChange(e.target.value === "" ? NaN : Math.round(Number(e.target.value)))}
      className="w-14 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-right text-xs tabular-nums text-[var(--text-primary)]"
    />
  );
}

function BellIcon(props: { on: boolean }) {
  return (
    <span
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
        props.on
          ? "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]"
          : "bg-[var(--surface-2)] text-[var(--text-muted)]"
      }`}
      aria-hidden
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 6.5a4 4 0 1 1 8 0c0 3 1.5 4.5 1.5 4.5h-11S4 9.5 4 6.5ZM6.5 13.5a1.5 1.5 0 0 0 3 0" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
