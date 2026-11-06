import type { ChargingSessionDto, DriveDto } from '@server/api-types';
import { describe, expect, it } from 'vitest';
import { drives, sessions } from '../../testing/fixtures';
import {
  type JourneyLeg,
  dayColor,
  journeyDays,
  journeyLegs,
  journeyRoads,
  journeyStops,
  replayFrame,
  stopPlaces,
} from './journey';

const local = (day: number, hour: number) => new Date(2026, 5, day, hour).toISOString();
const line = (lat: number, from: number, to: number): [number, number][] =>
  Array.from({ length: 11 }, (_, i) => [lat, from + ((to - from) * i) / 10]);

const place = (label: string) => ({
  label,
  address: null,
  isHome: false,
  locationId: null,
  unnamed: false,
});
const drive = (id: number, from: string, to: string, over: Partial<DriveDto> = {}) =>
  ({
    ...drives[0],
    id,
    startedAt: from,
    endedAt: to,
    start: place(`start${id}`),
    end: place(`end${id}`),
    startLat: 37,
    startLon: -119 + id,
    endLat: 37,
    endLon: -118 + id,
    ...over,
  }) as DriveDto;
const charge = (id: number, from: string, to: string, lat = 37, lon = -118) =>
  ({
    ...sessions[0],
    id,
    startedAt: from,
    endedAt: to,
    chargingStartedAt: null,
    chargingEndedAt: null,
    lat,
    lon,
  }) as ChargingSessionDto;

describe('dayColor', () => {
  it('gives a short trip distinct colors and never repeats one on a long trip', () => {
    const short = Array.from({ length: 5 }, (_, i) => dayColor(i, 5));
    expect(new Set(short).size).toBe(5);
    const long = Array.from({ length: 14 }, (_, i) => dayColor(i, 14));
    expect(new Set(long).size).toBe(14);
  });
});

describe('journeyRoads', () => {
  const leg = (id: number, points: [number, number][], color = 'blue'): JourneyLeg => ({
    missingBefore: null,
    id,
    dayKey: `day${id}`,
    color,
    points,
    gap: false,
    km: 0,
    title: drive(id, local(1, 9), local(1, 10)),
  });
  const road = line(37, -119, -118.9);
  const drawnBy = (roads: ReturnType<typeof journeyRoads>, id: number) =>
    roads.filter((r) => r.driveId === id);

  it('draws a road driven again the same way once, in the first day’s color', () => {
    const roads = journeyRoads([leg(1, road), leg(2, road, 'green')]);
    expect(drawnBy(roads, 2)).toEqual([]);
    expect(drawnBy(roads, 1).map((r) => r.color)).toEqual(['blue']);
  });

  it('folds in a pass whose GPS wandered a few meters', () => {
    const drift = road.map(([lat, lon]) => [lat + 0.0001, lon] as [number, number]);
    expect(drawnBy(journeyRoads([leg(1, road), leg(2, drift)]), 2)).toEqual([]);
  });

  it('keeps the way back, and a parallel street, as lines of their own', () => {
    const back = [...road].reverse();
    const parallel = road.map(([lat, lon]) => [lat + 0.002, lon] as [number, number]);
    const roads = journeyRoads([leg(1, road), leg(2, back), leg(3, parallel)]);
    expect(drawnBy(roads, 2)).toHaveLength(1);
    expect(drawnBy(roads, 3)).toHaveLength(1);
  });

  it('draws only where a drive leaves a road already drawn', () => {
    const onward = [...road, ...line(37, -118.9, -118.8).slice(1)];
    const roads = journeyRoads([leg(1, road), leg(2, onward)]);
    const own = drawnBy(roads, 2);
    expect(own).toHaveLength(1);
    // From one segment back along the road it leaves.
    expect(own[0]!.points[0]![1]).toBeCloseTo(-118.91, 6);
  });

  it('keeps the two sides of a divided road apart', () => {
    // The other carriageway, about 30 m over.
    const other = road.map(([lat, lon]) => [lat + 0.0003, lon] as [number, number]);
    expect(drawnBy(journeyRoads([leg(1, road), leg(2, other)]), 2)).toHaveLength(1);
  });

  it('draws a brief brush with another road rather than cut a gap in the line', () => {
    const fine = line(37, -119, -118.99).concat(line(37, -118.99, -118.98).slice(1));
    const crossing: [number, number][] = [
      [36.99, -118.995],
      [36.99995, -118.99505],
      [37.00005, -118.99495],
      [37.01, -118.985],
    ];
    const roads = journeyRoads([leg(1, fine), leg(2, crossing)]);
    expect(drawnBy(roads, 2)).toHaveLength(1);
    expect(drawnBy(roads, 2)[0]!.points).toHaveLength(4);
  });

  it('runs a line on into the road it joins, so they meet', () => {
    const side = line(37.01, -119.1, -119.0);
    const joining = [...side, [37, -118.99] as [number, number], ...road.slice(2)];
    const own = drawnBy(journeyRoads([leg(1, road), leg(2, joining)]), 2);
    expect(own).toHaveLength(1);
    // One segment along the road it joined, and no further.
    expect(own[0]!.points.at(-1)).toEqual([37, -118.98]);
  });
});

describe('journeyLegs', () => {
  const ds = [drive(1, local(1, 9), local(1, 10)), drive(2, local(2, 9), local(2, 10))];
  const days = journeyDays(ds, []);

  it('colors by day, in driving order', () => {
    const legs = journeyLegs(
      [ds[1]!, ds[0]!],
      [
        { driveId: 1, points: line(37, -119, -118), profile: [] },
        { driveId: 2, points: line(38, -119, -118), profile: [] },
      ],
      days,
    );
    expect(legs.map((l) => l.id)).toEqual([1, 2]);
    expect(legs[0]!.color).not.toBe(legs[1]!.color);
    expect(legs[0]!.gap).toBe(false);
  });

  it('marks a drive with no GPS as a gap, or leaves it off with no ends', () => {
    const legs = journeyLegs(ds, [], days);
    expect(legs.every((l) => l.gap && l.points.length === 2)).toBe(true);
    expect(journeyLegs([drive(1, local(1, 9), local(1, 10), { endLat: null })], [], days)).toEqual(
      [],
    );
  });
});

describe('journeyStops', () => {
  it('numbers the stops from 1, as on the timeline, but not the start, finish or a lone charge', () => {
    const stops = journeyStops(
      [drive(1, local(1, 9), local(1, 17)), drive(2, local(2, 8), local(2, 10))],
      [charge(1, local(1, 18), local(2, 6)), charge(2, local(2, 11), local(2, 12))],
    );
    expect(stops.map((s) => [s.id, s.number, s.kind])).toEqual([
      [1, null, 'start'],
      [2, 1, 'stop'],
      [3, null, 'end'],
      [4, null, 'charge'],
    ]);
    expect(stops[1]).toMatchObject({ place: 'end1', nights: 1 });
    expect(stops[1]!.charges).toHaveLength(1);
  });

  it('shares a marker for a place visited twice', () => {
    const home: Partial<DriveDto> = { startLat: 37, startLon: -119, endLat: 37, endLon: -119 };
    const stops = journeyStops(
      [
        drive(1, local(1, 9), local(1, 10), { ...home, endLon: -118 }),
        drive(2, local(1, 12), local(1, 13), { ...home, startLon: -118 }),
      ],
      [],
    );
    const places = stopPlaces(stops);
    expect(places.map((p) => p.stops.map((s) => s.kind))).toEqual([['start', 'end'], ['stop']]);
  });
});

describe('missing driving on the map', () => {
  // Drive 1 ends at -117; drive 3 starts at -116: a drive between isn't in the trip.
  const ds = [drive(1, local(1, 9), local(1, 10)), drive(3, local(1, 12), local(1, 13))];

  it('bridges the hole with its own line, and makes no stop of it', () => {
    const legs = journeyLegs(ds, [], journeyDays(ds, []));
    expect(legs.map((l) => l.missingBefore)).toEqual([
      null,
      [
        [37, -117],
        [37, -116],
      ],
    ]);
    const missing = journeyRoads(legs).filter((r) => r.missing);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ gap: false, driveId: 3 });
    expect(journeyStops(ds, []).map((s) => s.kind)).toEqual(['start', 'end']);
  });
});

describe('replayFrame', () => {
  const ds = [drive(1, local(1, 9), local(1, 10)), drive(2, local(2, 9), local(2, 10))];
  const legs = journeyLegs(
    ds,
    [
      { driveId: 1, points: line(37, -119, -118), profile: [] },
      { driveId: 2, points: line(38, -119, -118), profile: [] },
    ],
    journeyDays(ds, []),
  );

  it('starts at the start and ends with everything drawn', () => {
    expect(replayFrame(legs, 0).head).toEqual([37, -119]);
    const end = replayFrame(legs, 1);
    expect(end.lines.map((l) => l.id)).toEqual([1, 2]);
    expect(end.head![1]).toBeCloseTo(-118);
  });

  it('is partway along the right drive in the middle', () => {
    const frame = replayFrame(legs, 0.75);
    expect(frame.leg?.id).toBe(2);
    expect(frame.lines[0]!.points).toHaveLength(11);
    expect(frame.head![0]).toBe(38);
    expect(frame.head![1]).toBeCloseTo(-118.5, 1);
  });
});
