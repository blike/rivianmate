import { useState } from 'react';
import type {
  ImportChargePreview,
  ImportDrivePreview,
  ImportPreviewDto,
  ImportSessionAddition,
} from '../../api/client';
import { useUnits } from '../../api/hooks';
import { fmt } from '../../lib/state';
import { SegmentedControl } from './SettingsControls';

/** Up to this many rows start open; beyond it, only the newest month does. */
const OPEN_ALL_UP_TO = 30;

type Kind = 'drives' | 'charges';
type Filter = 'added' | 'skipped' | 'all';

const ADDITIONS: Readonly<Record<ImportSessionAddition, string>> = {
  chargingTime: 'charging time',
  batteryLevels: 'battery levels',
  energy: 'energy',
  range: 'range added',
  power: 'power',
  location: 'location',
  curve: 'charging curve',
};

/** Times in the export's zone, the one the owner just chose, not the browser's. */
export function timeSpan(startedAt: string, endedAt: string, timeZone: string): string {
  const day = new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const time = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  });
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  const sameDay = day.format(start) === day.format(end);
  return `${day.format(start)}, ${time.format(start)} – ${
    sameDay ? '' : `${day.format(end)}, `
  }${time.format(end)}`;
}

export function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** A start and end with an arrow when both are known, else whichever one is. */
const known = (start: string | null, end: string | null): string | null =>
  start && end ? `${start} → ${end}` : (start ?? end);

const levels = (start: number | null, end: number | null): string | null =>
  known(start == null ? null : `${fmt(start, 0)}%`, end == null ? null : `${fmt(end, 0)}%`);

/** The first letter up, for a list that starts a sentence. */
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const isAdded = (status: ImportChargePreview['status']) => status === 'new' || status === 'enrich';

function Status(props: { status: ImportChargePreview['status'] }) {
  const { label, tone, title } = {
    new: {
      label: 'Will import',
      tone: 'text-(--status-good)',
      title: 'Not stored yet, so this adds it.',
    },
    enrich: {
      label: 'Adds detail',
      tone: 'text-(--accent)',
      title: 'Overlaps a charge you already have, which keeps its own figures.',
    },
    recorded: {
      label: 'Already recorded',
      tone: 'text-(--text-muted)',
      title: 'RivianMate already has this, so it’s left alone.',
    },
    newer: {
      label: 'Too recent',
      tone: 'text-(--status-warning)',
      title: 'Later than RivianMate last heard from the vehicle, so it’s left for live tracking.',
    },
  }[props.status];
  return (
    <span title={title} className={`shrink-0 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}

function Row(props: {
  title: string;
  details: (string | null)[];
  note?: string | null;
  status: ImportChargePreview['status'];
}) {
  return (
    <li className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm">{props.title}</div>
        <div className="mt-0.5 text-xs text-(--text-muted)">
          {props.details.filter(Boolean).join(' · ')}
        </div>
        {props.note && <div className="mt-0.5 text-xs text-(--text-secondary)">{props.note}</div>}
      </div>
      <Status status={props.status} />
    </li>
  );
}

function DriveRow(props: { drive: ImportDrivePreview; timeZone: string }) {
  const u = useUnits();
  const d = props.drive;
  // One end alone says little about the drive.
  const places = d.startPlace && d.endPlace ? `${d.startPlace} → ${d.endPlace}` : null;
  const seconds = (Date.parse(d.endedAt) - Date.parse(d.startedAt)) / 1000;
  return (
    <Row
      title={timeSpan(d.startedAt, d.endedAt, props.timeZone)}
      status={d.status}
      details={[
        places,
        u.formatDistance(d.distanceKm, 1),
        duration(seconds),
        levels(d.startBattery, d.endBattery),
      ]}
    />
  );
}

export function ChargeRow(props: { charge: ImportChargePreview; timeZone: string }) {
  const c = props.charge;
  // On a charge you already have, only what would change: its other figures stay its own.
  const enriching = c.status === 'enrich';
  const shows = (addition: ImportSessionAddition) => !enriching || c.adds.includes(addition);
  return (
    <Row
      title={timeSpan(c.startedAt, c.endedAt, props.timeZone)}
      status={c.status}
      details={[
        c.place,
        shows('energy') && c.energyKwh != null ? `${fmt(c.energyKwh, 1)} kWh` : null,
        shows('chargingTime') ? duration(c.chargingSeconds) : null,
        shows('batteryLevels') ? levels(c.startSoc, c.endSoc) : null,
        shows('power') && c.maxPowerKw != null ? `up to ${fmt(c.maxPowerKw, 1)} kW` : null,
      ]}
      note={
        enriching
          ? `${sentence(c.adds.map((a) => ADDITIONS[a]).join(', '))} for the charge you already have.`
          : null
      }
    />
  );
}

type Item = ImportDrivePreview | ImportChargePreview;

const isCharge = (item: Item): item is ImportChargePreview => 'adds' in item;
const imports = (item: Item) => isAdded(item.status);

export interface MonthGroup {
  key: string;
  label: string;
  items: Item[];
}

/** Newest month first, newest item first, by the month in the chosen zone. */
export function groupByMonth(items: readonly Item[], timeZone: string): MonthGroup[] {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' });
  const label = new Intl.DateTimeFormat(undefined, { timeZone, year: 'numeric', month: 'long' });
  const groups = new Map<string, MonthGroup>();
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    const at = new Date(item.startedAt);
    const month = key.format(at);
    const group = groups.get(month);
    if (group) group.items.push(item);
    else groups.set(month, { key: month, label: label.format(at), items: [item] });
  }
  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));
}

function Month(props: { group: MonthGroup; kind: Kind; open: boolean; timeZone: string }) {
  const u = useUnits();
  const { items } = props.group;
  const importing = items.filter(imports);
  const skipped = items.length - importing.length;
  const total =
    props.kind === 'drives'
      ? u.formatDistance(
          importing.reduce((km, i) => km + (isCharge(i) ? 0 : (i.distanceKm ?? 0)), 0),
        )
      : `${fmt(
          importing.reduce(
            (kwh, i) => kwh + (isCharge(i) && i.status === 'new' ? (i.energyKwh ?? 0) : 0),
            0,
          ),
          0,
        )} kWh`;
  return (
    <details open={props.open} className="group">
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-medium">
          <span
            aria-hidden
            className="mr-1.5 inline-block text-(--text-muted) transition-transform group-open:rotate-90"
          >
            ›
          </span>
          {props.group.label}
        </span>
        <span className="text-right text-xs text-(--text-muted) tabular-nums">
          {importing.length > 0 && `${importing.length.toLocaleString()} to import · ${total}`}
          {importing.length > 0 && skipped > 0 && ' · '}
          {skipped > 0 && `${skipped.toLocaleString()} skipped`}
        </span>
      </summary>
      <ul className="divide-y divide-(--border) border-t border-(--border)">
        {items.map((item) =>
          isCharge(item) ? (
            <ChargeRow key={item.startedAt} charge={item} timeZone={props.timeZone} />
          ) : (
            <DriveRow key={item.startedAt} drive={item} timeZone={props.timeZone} />
          ),
        )}
      </ul>
    </details>
  );
}

/** Every drive and charge in the chosen dates by month, with what happens to each. */
export function ImportPreviewList(props: { preview: ImportPreviewDto; timeZone: string }) {
  const { drives, charges } = props.preview;
  const [kind, setKind] = useState<Kind>('drives');
  const [filter, setFilter] = useState<Filter>('all');

  const source: readonly Item[] = kind === 'drives' ? drives : charges;
  const items = source.filter((i) => filter === 'all' || (filter === 'added') === imports(i));
  const months = groupByMonth(items, props.timeZone);

  return (
    <div className="px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          label="Show"
          value={kind}
          options={[
            { value: 'drives', label: `Drives (${drives.length.toLocaleString()})` },
            { value: 'charges', label: `Charges (${charges.length.toLocaleString()})` },
          ]}
          onChange={setKind}
        />
        <SegmentedControl
          label="Filter"
          value={filter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'added', label: 'Importing' },
            { value: 'skipped', label: 'Skipped' },
          ]}
          onChange={setFilter}
        />
      </div>
      {months.length === 0 ? (
        <p className="py-6 text-center text-sm text-(--text-muted)">
          {filter === 'all'
            ? `No ${kind} in these dates.`
            : `No ${kind} ${filter === 'added' ? 'to import' : 'skipped'} in these dates.`}
        </p>
      ) : (
        <div className="mt-2 divide-y divide-(--border)">
          {months.map((group, i) => (
            <Month
              // Tab or filter changes start the sections over.
              key={`${kind}-${filter}-${group.key}`}
              group={group}
              kind={kind}
              open={items.length <= OPEN_ALL_UP_TO || i === 0}
              timeZone={props.timeZone}
            />
          ))}
        </div>
      )}
    </div>
  );
}
