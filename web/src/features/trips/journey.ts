import type { ChargingSessionDto, DriveDto, TripRouteDto } from '@server/api-types';
import { haversineKm } from '../../lib/geo';
import { localKey } from '../../lib/drives';
import { chargeEnd, chargeStart } from '../charging/sessions';
import { type TimelineEntry, missingBetween, timelineEntries, byStart } from './trips';

type LatLon = [number, number];

/** Validated against the map's background; yellow stays the app's "you are here". */
const DAY_COLORS = ['#3987e5', '#199e70', '#9a6fe0', '#bd7f22', '#d5618f'];
const RAMP_FROM = [0x2c, 0x63, 0xad];
const RAMP_TO = [0x9f, 0xc8, 0xf8];

/**
 * A day's color. Beyond what can be told apart, colors would have to repeat,
 * so a longer trip goes from dark to light blue over its days instead.
 */
export function dayColor(index: number, days: number): string {
  if (days <= DAY_COLORS.length) return DAY_COLORS[index] ?? DAY_COLORS[0]!;
  const t = days > 1 ? index / (days - 1) : 0;
  const channel = (i: number) => Math.round(RAMP_FROM[i]! + (RAMP_TO[i]! - RAMP_FROM[i]!) * t);
  return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`;
}

/**
 * Road cells about 11 m across: passes within a cell or so (GPS drift) are
 * one road, while a divided road's two sides, 20 m or more apart, stay two.
 */
const CELL_DEG = 0.0001;
const DIRECTIONS = 8;
/** A stretch this much already drawn is a repeat, and isn't drawn again. */
const REPEAT_SHARE = 0.6;
/** A repeat shorter than this is drawn anyway: cutting it out leaves gaps and stubs. */
const MIN_REPEAT_KM = 0.1;

type Cell = { lat: number; lon: number; heading: number };
/** A cell as one number (lat and lon indexes fit 20 and 21 bits), as string keys are slow at scale. */
const cellKey = (c: Cell) =>
  ((c.lat + 2 ** 19) * 2 ** 21 + (c.lon + 2 ** 20)) * DIRECTIONS + c.heading;

/** The cells a segment passes through, with the way it was heading. */
function segmentCells(a: LatLon, b: LatLon): Cell[] {
  const angle = Math.atan2(b[0] - a[0], b[1] - a[1]);
  const heading = Math.round(((angle + Math.PI) / (2 * Math.PI)) * DIRECTIONS) % DIRECTIONS;
  const steps = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / CELL_DEG),
  );
  const cells = new Map<number, Cell>();
  for (let s = 0; s <= steps; s++) {
    const cell = {
      lat: Math.round((a[0] + ((b[0] - a[0]) * s) / steps) / CELL_DEG),
      lon: Math.round((a[1] + ((b[1] - a[1]) * s) / steps) / CELL_DEG),
      heading,
    };
    cells.set(cellKey(cell), cell);
  }
  return [...cells.values()];
}

/** A cell and those around it, heading about the same way: where another pass would land. */
function nearby(c: Cell): number[] {
  const keys: number[] = [];
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLon = -1; dLon <= 1; dLon++) {
      for (let dH = -1; dH <= 1; dH++) {
        keys.push(
          cellKey({
            lat: c.lat + dLat,
            lon: c.lon + dLon,
            heading: (c.heading + dH + DIRECTIONS) % DIRECTIONS,
          }),
        );
      }
    }
  }
  return keys;
}

/** A stretch of road, drawn once however often it was driven. */
export interface JourneyRoad {
  points: LatLon[];
  /** The day that first drove it. */
  color: string;
  dayKey: string;
  driveId: number;
  gap: boolean;
  /** Driving the trip has no record of, from one drive's end to the next's start. */
  missing: boolean;
}

/**
 * The journey's roads, each stretch once. GPS never retraces a road exactly,
 * so drawing every pass leaves a fringe of near-parallel lines; instead a
 * repeat the same way is left to the line already there, and a drive is
 * drawn only where it goes somewhere new. The way back is a different
 * direction, so it stays its own line, beside the way out.
 */
export function journeyRoads(legs: readonly JourneyLeg[]): JourneyRoad[] {
  // Which drive drew near each cell first; a drive's own cells don't make it a repeat.
  const drawn = new Map<number, number>();
  const roads: JourneyRoad[] = [];
  legs.forEach((leg, l) => {
    const road = (points: LatLon[]) => ({
      points,
      color: leg.color,
      dayKey: leg.dayKey,
      driveId: leg.id,
      gap: leg.gap,
      missing: false,
    });
    if (leg.missingBefore) {
      roads.push({ ...road(leg.missingBefore), gap: false, missing: true });
    }
    if (leg.gap) {
      roads.push(road(leg.points));
      return;
    }
    type Segment = { a: LatLon; b: LatLon; cells: Cell[]; km: number };
    let run: LatLon[] | null = null;
    // Repeated segments not yet left out: a short repeat is drawn after all.
    let pending: Segment[] = [];
    let skipping = false;
    const flush = () => {
      if (run && run.length > 1) roads.push(road(run));
      run = null;
    };
    const draw = (seg: Segment) => {
      if (run) run.push(seg.b);
      else run = [seg.a, seg.b];
      for (const c of seg.cells) {
        for (const key of nearby(c)) if (!drawn.has(key)) drawn.set(key, l);
      }
    };
    for (let i = 1; i < leg.points.length; i++) {
      const a = leg.points[i - 1]!;
      const b = leg.points[i]!;
      const cells = segmentCells(a, b);
      const seen =
        cells.filter((c) => {
          const by = drawn.get(cellKey(c));
          return by != null && by !== l;
        }).length / cells.length;
      const seg = { a, b, cells, km: haversineKm(a[0], a[1], b[0], b[1]) };
      if (seen >= REPEAT_SHARE) {
        pending.push(seg);
        if (!skipping && pending.reduce((sum, p) => sum + p.km, 0) >= MIN_REPEAT_KM) {
          // Into the road it joins by a segment, so the two lines meet.
          run?.push(pending[0]!.b);
          flush();
          skipping = true;
        }
        continue;
      }
      if (skipping) {
        // Out of the road it leaves from a segment back, so they meet there too.
        run = [pending.at(-1)!.a];
      } else {
        pending.forEach(draw);
      }
      pending = [];
      skipping = false;
      draw(seg);
    }
    if (!skipping) pending.forEach(draw);
    flush();
  });
  return roads;
}

export interface JourneyDay {
  key: string;
  index: number;
  color: string;
}

export interface JourneyLeg {
  id: number;
  dayKey: string;
  color: string;
  points: LatLon[];
  /** No GPS for it: a straight line from where it started to where it ended. */
  gap: boolean;
  /**
   * From where the drive before ended to where this one starts, when they
   * don't meet: driving that isn't in the trip.
   */
  missingBefore: [LatLon, LatLon] | null;
  /** Route length, for pacing a replay. */
  km: number;
  title: DriveDto;
}

function lineKm(points: readonly LatLon[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    km += haversineKm(points[i - 1]![0], points[i - 1]![1], points[i]![0], points[i]![1]);
  }
  return km;
}

/** The local days the journey has activity on, oldest first. */
export function journeyDays(
  drives: readonly DriveDto[],
  sessions: readonly ChargingSessionDto[],
): JourneyDay[] {
  const keys = [
    ...new Set([...drives.map((d) => d.startedAt), ...sessions.map(chargeStart)].map(localKey)),
  ].sort();
  return keys.map((key, index) => ({ key, index, color: dayColor(index, keys.length) }));
}

/** The drives as lines on the map, oldest first. */
export function journeyLegs(
  drives: readonly DriveDto[],
  routes: readonly TripRouteDto[],
  days: readonly JourneyDay[],
): JourneyLeg[] {
  const byId = new Map(routes.map((r) => [r.driveId, r.points]));
  const sorted = [...drives].sort(byStart).flatMap((d, i, all) => {
    const before = all[i - 1];
    const missingBefore: [LatLon, LatLon] | null =
      before && missingBetween(before, d) ? [endPoint(before)!, startPoint(d)!] : null;
    const route = byId.get(d.id);
    if (route && route.length > 1) return [{ d, points: route, gap: false, missingBefore }];
    if (d.startLat == null || d.startLon == null || d.endLat == null || d.endLon == null) {
      return [];
    }
    const points: LatLon[] = [
      [d.startLat, d.startLon],
      [d.endLat, d.endLon],
    ];
    return [{ d, points, gap: true, missingBefore }];
  });
  return sorted.map(({ d, points, gap, missingBefore }) => {
    const dayKey = localKey(d.startedAt);
    return {
      id: d.id,
      dayKey,
      color: days.find((day) => day.key === dayKey)?.color ?? DAY_COLORS[0]!,
      points,
      gap,
      missingBefore,
      km: lineKm(points),
      title: d,
    };
  });
}

export interface JourneyStop {
  /** Unique within the journey, in visiting order. */
  id: number;
  /** Stops between drives, numbered as on the timeline; null for the rest. */
  number: number | null;
  /** A charge before the first drive or after the last is a charge on its own. */
  kind: 'start' | 'stop' | 'charge' | 'end';
  at: LatLon | null;
  place: string | null;
  isHome: boolean;
  startedAt: string;
  endedAt: string | null;
  nights: number;
  charges: ChargingSessionDto[];
}

const chargeAt = (s: ChargingSessionDto): LatLon | null =>
  s.lat != null && s.lon != null ? [s.lat, s.lon] : null;

const startPoint = (d: DriveDto): LatLon | null =>
  d.startLat != null && d.startLon != null ? [d.startLat, d.startLon] : null;
const endPoint = (d: DriveDto): LatLon | null =>
  d.endLat != null && d.endLon != null ? [d.endLat, d.endLon] : null;

/** Everywhere the journey paused, in order: where it set out, each stop, and where it finished. */
export function journeyStops(
  drives: readonly DriveDto[],
  sessions: readonly ChargingSessionDto[],
): JourneyStop[] {
  const entries = timelineEntries(drives, sessions);
  const stops: Omit<JourneyStop, 'id' | 'number'>[] = [];
  const firstDrive = entries.findIndex((e) => e.kind === 'drive');
  const lastDrive = entries.map((e) => e.kind).lastIndexOf('drive');
  entries.forEach((entry: TimelineEntry, i) => {
    if (entry.kind === 'charge') {
      stops.push({
        kind: 'charge',
        at: chargeAt(entry.session),
        place: entry.session.location?.name ?? entry.session.city ?? null,
        isHome: entry.session.isHome,
        // When it charged, as on the charging page, not when it was plugged in.
        startedAt: chargeStart(entry.session),
        endedAt: chargeEnd(entry.session),
        nights: 0,
        charges: [entry.session],
      });
    } else if (entry.kind === 'missing') {
      // Not a stop: where it went then isn't known.
      return;
    } else if (entry.kind === 'stop') {
      const previous = entries[i - 1];
      const drive = previous?.kind === 'drive' ? previous.drive : null;
      stops.push({
        kind: 'stop',
        at: (drive && endPoint(drive)) ?? (entry.charges[0] ? chargeAt(entry.charges[0]) : null),
        place: entry.place,
        isHome: drive?.end?.isHome ?? false,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        nights: entry.nights,
        charges: entry.charges,
      });
    } else {
      if (i === firstDrive) {
        stops.push({
          kind: 'start',
          at: startPoint(entry.drive),
          place: entry.drive.start?.label ?? null,
          isHome: entry.drive.start?.isHome ?? false,
          startedAt: entry.drive.startedAt,
          endedAt: null,
          nights: 0,
          charges: [],
        });
      }
      if (i === lastDrive) {
        stops.push({
          kind: 'end',
          at: endPoint(entry.drive),
          place: entry.drive.end?.label ?? null,
          isHome: entry.drive.end?.isHome ?? false,
          startedAt: entry.drive.endedAt ?? entry.drive.startedAt,
          endedAt: null,
          nights: 0,
          charges: [],
        });
      }
    }
  });
  stops.sort(byStart);
  let number = 0;
  return stops.map((s, i) => ({ ...s, id: i + 1, number: s.kind === 'stop' ? ++number : null }));
}

/** Stops closer than this share one marker: the same hotel twice, or home and home. */
const SAME_PLACE_KM = 0.2;

/** Stops grouped by place, so returning somewhere doesn't stack one marker on another. */
export function stopPlaces(stops: readonly JourneyStop[]): { at: LatLon; stops: JourneyStop[] }[] {
  const places: { at: LatLon; stops: JourneyStop[] }[] = [];
  for (const stop of stops) {
    const at = stop.at;
    if (!at) continue;
    const same = places.find((p) => haversineKm(p.at[0], p.at[1], at[0], at[1]) < SAME_PLACE_KM);
    if (same) same.stops.push(stop);
    else places.push({ at, stops: [stop] });
  }
  return places;
}

export interface ReplayFrame {
  /** What's been driven so far, a line per leg. */
  lines: { id: number; color: string; points: LatLon[] }[];
  head: LatLon | null;
  leg: JourneyLeg | null;
}

/**
 * The journey so far at `progress` (0–1), by distance, so the replay moves at
 * a steady pace and spends no time on the nights in between.
 */
export function replayFrame(legs: readonly JourneyLeg[], progress: number): ReplayFrame {
  const total = legs.reduce((sum, l) => sum + l.km, 0);
  let remaining = Math.min(1, Math.max(0, progress)) * total;
  const lines: ReplayFrame['lines'] = [];
  let head: LatLon | null = null;
  let current: JourneyLeg | null = null;
  for (const leg of legs) {
    current = leg;
    const line = { id: leg.id, color: leg.color };
    if (remaining >= leg.km) {
      lines.push({ ...line, points: leg.points });
      head = leg.points.at(-1) ?? head;
      remaining -= leg.km;
      if (remaining <= 0) break;
      continue;
    }
    const points: LatLon[] = [leg.points[0]!];
    for (let i = 1; i < leg.points.length; i++) {
      const a = leg.points[i - 1]!;
      const b = leg.points[i]!;
      const step = haversineKm(a[0], a[1], b[0], b[1]);
      if (step >= remaining) {
        const t = step > 0 ? remaining / step : 0;
        points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        break;
      }
      points.push(b);
      remaining -= step;
    }
    lines.push({ ...line, points });
    head = points.at(-1)!;
    break;
  }
  return { lines, head, leg: current };
}
