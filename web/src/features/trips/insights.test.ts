import type { ChargingSessionDto, DriveDto, TripDetailDto, TripStatsDto } from '@server/api-types';
import { describe, expect, it } from 'vitest';
import { haversineKm } from '../../lib/geo';
import { unitFormatter } from '../../lib/units';
import { drives, sessions } from '../../testing/fixtures';
import {
  daySummaries,
  farthestPoint,
  isRoundTrip,
  roadProfile,
  bridgeGaps,
  suggestedName,
  driverSplit,
  timeSplit,
  tripFacts,
  stayRoute,
  staysSummary,
  tripStays,
} from './insights';

const u = unitFormatter({ distance: 'mi', temperature: 'F' });
const local = (day: number, hour: number) => new Date(2026, 5, day, hour).toISOString();
const place = (label: string) => ({
  label,
  address: null,
  isHome: false,
  locationId: null,
  unnamed: false,
});
const drive = (id: number, over: Partial<DriveDto> = {}) =>
  ({
    ...drives[0],
    id,
    startedAt: local(id, 9),
    endedAt: local(id, 12),
    distanceKm: 200,
    energyKwh: 50,
    elevationGainM: 100,
    elevationLossM: 100,
    movingSeconds: 10800,
    outsideTempC: 20,
    weather: null,
    start: place('San Diego'),
    end: place('Yosemite Valley'),
    startLat: 32.7,
    startLon: -117.2,
    endLat: 37.7,
    endLon: -119.6,
    ...over,
  }) as DriveDto;
/** A battery that holds level, for drives whose charge isn't what's tested. */
const level = { startBattery: 80, endBattery: 80 };
/** Starts where the default drive ends, so drives in a row meet rather than leave a gap. */
const meets = { startLat: 37.7, startLon: -119.6 };
const charge = (id: number, over: Partial<ChargingSessionDto> = {}) =>
  ({
    ...sessions[0],
    id,
    // Charging from plug-in to unplug, unless a test says otherwise.
    chargingStartedAt: null,
    chargingEndedAt: null,
    startedAt: local(1, 13),
    endedAt: local(1, 14),
    ...over,
  }) as ChargingSessionDto;

const stats = (over: Partial<TripStatsDto> = {}): TripStatsDto => ({
  drives: 1,
  charges: 0,
  startedAt: local(1, 9),
  endedAt: local(3, 9),
  lastStartedAt: local(3, 8),
  distanceKm: 800,
  drivesWithDistance: 1,
  drivingSeconds: 36000,
  chargingSeconds: 3600,
  chargesWithTime: 1,
  energyUsedKwh: 240,
  energyAddedKwh: 100,
  energyAddedEstimated: false,
  chargesWithEnergy: 1,
  efficiency: null,
  costs: [],
  chargesWithCost: 0,
  ...over,
});
const trip = (ds: DriveDto[], ss: ChargingSessionDto[] = [], over: Partial<TripStatsDto> = {}) =>
  ({ drives: ds, sessions: ss, stats: stats(over) }) as unknown as TripDetailDto;

describe('the journey’s shape', () => {
  it('finds the farthest place and suggests a name from it', () => {
    const ds = [
      drive(1, { end: place('1 Main Street, Fresno'), endLat: 36.7, endLon: -119.8 }),
      drive(2, { end: place('9 Village Drive, Yosemite Valley') }),
    ];
    expect(farthestPoint(ds)?.drive.id).toBe(2);
    expect(suggestedName(ds)).toBe('Trip to Yosemite Valley');
  });

  it('names a trip by the town, not the street', () => {
    const at = (end: DriveDto['end']) => suggestedName([drive(1, { end })]);
    expect(at(place('12 Yucca Avenue, Bloomington'))).toBe('Trip to Bloomington');
    expect(at(place('Yucca Avenue'))).toBeNull();
    expect(at({ ...place('Grandma'), locationId: 4 })).toBe('Trip to Grandma');
    expect(at({ ...place('Jumbo Rocks Campground'), navigated: true })).toBe(
      'Trip to Jumbo Rocks Campground',
    );
  });

  it('suggests no name without places or for going nowhere', () => {
    expect(suggestedName([])).toBeNull();
    expect(suggestedName([drive(1, { endLat: 32.7, endLon: -117.2 })])).toBeNull();
  });

  it('tells a round trip from a one-way one', () => {
    expect(isRoundTrip([drive(1)])).toBe(false);
    expect(
      isRoundTrip([drive(1), drive(2, { endLat: 32.7, endLon: -117.2, end: place('San Diego') })]),
    ).toBe(true);
  });

  it('lists each stay, nights in a row at one place together, home too', () => {
    const home = { ...place('Home'), isHome: true };
    const camp = place('Jumbo Rocks');
    const ds = [
      drive(1, { ...meets, start: home, end: camp }),
      // A day out from camp and back doesn't split the stay.
      drive(2, { ...meets, start: camp, end: place('Hidden Valley') }),
      drive(2, {
        ...meets,
        startedAt: local(2, 15),
        endedAt: local(2, 16),
        start: place('Hidden Valley'),
        end: camp,
      }),
      drive(3, { ...meets, start: camp, end: home }),
      drive(5, { ...meets, start: home, end: place('Palm Springs') }),
    ];
    const stays = tripStays(ds, []);
    expect(stays).toMatchObject([
      { place: 'Jumbo Rocks', isHome: false, from: '2026-06-01', nights: 2 },
      { place: 'Home', isHome: true, from: '2026-06-03', nights: 2 },
    ]);
    expect(stays[0]!.arrivedAt).toBe(local(1, 12));
    expect(stays[0]!.leftAt).toBe(local(3, 9));
  });

  it('lays the journey out stop by stop, with the distance to each', () => {
    const home = { ...place('Home'), isHome: true };
    const camp = place('Jumbo Rocks');
    const ds = [
      drive(1, { ...meets, start: home, end: camp, distanceKm: 200 }),
      // Out and back from camp counts toward the stay.
      drive(2, { ...meets, start: camp, end: place('Hidden Valley'), distanceKm: 10 }),
      drive(2, {
        ...meets,
        startedAt: local(2, 15),
        endedAt: local(2, 16),
        start: place('Hidden Valley'),
        end: camp,
        distanceKm: 10,
      }),
      drive(3, { ...meets, start: camp, end: place('Las Vegas'), distanceKm: 300 }),
      drive(5, { ...meets, start: place('Las Vegas'), end: home, distanceKm: 450 }),
    ];
    const route = stayRoute(ds, tripStays(ds, []));
    expect(route.map((p) => p.kind)).toEqual(['start', 'stay', 'stay', 'end']);
    expect(route[0]).toMatchObject({ place: 'Home', isHome: true });
    expect(route.slice(1).map((p) => ('kmBefore' in p ? p.kmBefore : null))).toEqual([
      200, 300, 450,
    ]);
    expect(route[3]).toMatchObject({ place: 'Home', isHome: true });
  });
});

describe('staysSummary', () => {
  const stay = (place: string, nights: number, isHome = false) => ({
    place,
    nights,
    isHome,
    from: '2026-06-01',
    arrivedAt: '',
    leftAt: '',
  });

  it('says nothing for a trip that slept only at home', () => {
    expect(staysSummary([])).toBeNull();
    expect(staysSummary([stay('Home', 2, true)])).toBeNull();
  });

  it('names a few places in order, a place once however often it came back', () => {
    const summary = staysSummary([
      stay('Jumbo Rocks', 2),
      stay('Home', 1, true),
      stay('Las Vegas', 1),
      stay('Jumbo Rocks', 1),
    ]);
    expect(summary).toEqual({
      nights: 4,
      places: 2,
      named: [
        { place: 'Jumbo Rocks', nights: 3 },
        { place: 'Las Vegas', nights: 1 },
      ],
      more: 0,
      homeNights: 1,
    });
  });

  it('names the longest stays of many, and counts the rest', () => {
    const many = ['A', 'B', 'C', 'Zion', 'D', 'E', 'F'].map((p) => stay(p, p === 'Zion' ? 3 : 1));
    const summary = staysSummary(many)!;
    expect(summary.nights).toBe(9);
    expect(summary.places).toBe(7);
    expect(summary.named.map((n) => n.place)).toEqual(['Zion', 'A', 'B']);
    expect(summary.more).toBe(4);
  });
});

describe('driverSplit', () => {
  const who = (id: number, name: string) => ({ id, name, source: 'profile' as const });

  it('adds up each driver, the most first and unknown last', () => {
    const split = driverSplit([
      drive(1, { driver: who(1, 'Sam'), distanceKm: 100 }),
      drive(2, { driver: null, distanceKm: 300 }),
      drive(3, { driver: who(2, 'Alex'), distanceKm: 150 }),
      drive(4, { driver: who(1, 'Sam'), distanceKm: 100 }),
    ]);
    expect(split.map((s) => [s.name, s.distanceKm, s.drives])).toEqual([
      ['Sam', 200, 2],
      ['Alex', 150, 1],
      [null, 300, 1],
    ]);
    expect(split[0]!.seconds).toBe(6 * 3600);
  });

  it('is empty when no driver is known', () => {
    expect(driverSplit([drive(1, { driver: null })])).toEqual([]);
  });
});

describe('tripFacts', () => {
  const keys = (t: TripDetailDto, routes: Parameters<typeof tripFacts>[1] = []) =>
    tripFacts(t, routes, u).map((f) => f.key);

  it('only says what the data backs up', () => {
    const k = keys(
      trip([drive(1, { elevationGainM: null, elevationLossM: null, endBattery: null })], [], {
        distanceKm: 10,
        energyUsedKwh: 2,
        chargingSeconds: 0,
      }),
    );
    expect(k).not.toContain('climb');
    expect(k).not.toContain('highest');
    expect(k).not.toContain('low');
  });

  it('gives the climb', () => {
    const climb = tripFacts(
      trip([drive(1, { elevationGainM: 900, elevationLossM: 300 })]),
      [],
      u,
    ).find((f) => f.key === 'climb');
    expect(climb?.value).toBe(u.formatElevation(900));
  });

  it('gives cost per mile only when every charge has a cost in one currency', () => {
    const cost = { currency: 'USD', amount: 50, estimated: false };
    expect(
      keys(trip([drive(1)], [charge(1)], { charges: 1, chargesWithCost: 1, costs: [cost] })),
    ).toContain('perDistance');
    expect(
      keys(trip([drive(1)], [charge(1)], { charges: 2, chargesWithCost: 1, costs: [cost] })),
    ).not.toContain('perDistance');
    expect(
      keys(
        trip([drive(1)], [charge(1)], {
          charges: 2,
          chargesWithCost: 2,
          costs: [cost, { ...cost, currency: 'CAD' }],
        }),
      ),
    ).not.toContain('perDistance');
  });

  it('finds the highest point from the route', () => {
    const fact = tripFacts(
      trip([drive(1)]),
      [
        {
          driveId: 1,
          points: [],
          profile: [
            { km: 0, altitudeM: 100 },
            { km: 1, altitudeM: 2000 },
          ],
        },
      ],
      u,
    ).find((f) => f.key === 'highest');
    expect(fact?.value).toContain('6,562');
  });
});

describe('roadProfile', () => {
  const route = (driveId: number, ...km: number[]) => ({
    driveId,
    points: [],
    profile: km.map((k, i) => ({ km: k, altitudeM: 100 + i })),
  });

  it('runs drives end to end at their odometer length, so it reaches the total', () => {
    const road = roadProfile(
      [
        drive(2, {
          ...meets,
          ...level,
          distanceKm: 40,
          startedAt: local(2, 8),
          endedAt: local(2, 9),
        }),
        drive(1, {
          ...meets,
          ...level,
          distanceKm: 20,
          startedAt: local(1, 8),
          endedAt: local(1, 9),
        }),
      ],
      [],
      // The route reads a little short of the odometer; it's stretched to fit.
      [route(1, 0, 5, 10), route(2, 0, 40)],
    );
    expect(road.points.map((p) => p.km)).toEqual([0, 10, 20, 20, 60]);
    expect(road.days.map((d) => d.km)).toEqual([0, 20]);
    expect(road.unmappedKm).toBe(0);
  });

  it('leaves a gap in the ground for a drive with no route, but keeps its distance', () => {
    const road = roadProfile(
      [
        drive(1, {
          ...meets,
          ...level,
          distanceKm: 10,
          startedAt: local(1, 8),
          endedAt: local(1, 9),
        }),
        drive(2, {
          ...meets,
          ...level,
          distanceKm: 30,
          startedAt: local(1, 10),
          endedAt: local(1, 11),
        }),
      ],
      [],
      [route(1, 0, 10)],
    );
    expect(road.points.map((p) => [p.km, p.elevationM])).toEqual([
      [0, 100],
      [10, 101],
      [10, null],
      [40, null],
    ]);
    expect(road.unmappedKm).toBe(30);
  });

  it('falls along each drive and rises in place on a charge', () => {
    const road = roadProfile(
      [
        drive(1, {
          ...meets,
          distanceKm: 100,
          startBattery: 90,
          endBattery: 30,
          startedAt: local(1, 8),
          endedAt: local(1, 11),
        }),
        drive(2, {
          ...meets,
          distanceKm: 50,
          startBattery: 80,
          endBattery: 60,
          startedAt: local(1, 14),
          endedAt: local(1, 15),
        }),
      ],
      [
        charge(1, {
          startSoc: 30,
          endSoc: 80,
          startedAt: local(1, 12),
          endedAt: local(1, 13),
          chargingStartedAt: null,
          chargingEndedAt: null,
        }),
      ],
      [route(1, 0, 50, 100)],
    );
    expect(road.points.map((p) => [p.km, p.battery])).toEqual([
      [0, 90],
      [50, 60],
      [100, 30],
      [100, 30],
      [100, 80],
      [100, 80],
      [150, 60],
    ]);
  });
});

describe('roadProfile across missing driving', () => {
  it('spans driving not in the trip as the crow flies, with nothing read across it', () => {
    const road = roadProfile(
      [
        drive(1, { distanceKm: 100, startBattery: 90, endBattery: 60, startedAt: local(1, 8) }),
        // Starts back where it set out, so the drive between isn't in the trip.
        drive(2, { distanceKm: 50, startBattery: 45, endBattery: 30, startedAt: local(2, 8) }),
      ],
      [],
      [],
    );
    const gap = haversineKm(37.7, -119.6, 32.7, -117.2);
    expect(road.missingKm).toBeCloseTo(gap);
    const km = road.points.map((p) => p.km);
    expect(km[2]).toBeCloseTo(100 + gap / 2);
    expect(km[3]).toBeCloseTo(100 + gap);
    expect(road.points.map((p) => p.battery)).toEqual([90, 60, null, 45, 30]);
    // So the dashed line runs from where one left off to where the next picked up.
    expect(bridgeGaps(km, [90, 60, null, 45, 30])[2]).toBeCloseTo(52.5);
  });
});

describe('roadProfile across a charge not in the trip', () => {
  const pair = (startBattery: number) =>
    roadProfile(
      [
        drive(1, { ...meets, distanceKm: 100, startBattery: 90, endBattery: 30 }),
        drive(2, {
          ...meets,
          distanceKm: 50,
          startBattery,
          endBattery: 60,
          startedAt: local(2, 8),
        }),
      ],
      [],
      [],
    );

  it('leaves a level it has no record of reaching to the dashed line, not a jump', () => {
    expect(pair(80).points.map((p) => [p.km, p.battery])).toEqual([
      [0, 90],
      [100, 30],
      [100, null],
      [100, 80],
      [150, 60],
    ]);
  });

  it('joins a drive on where the last left off, give or take a point', () => {
    expect(pair(31).points.map((p) => p.battery)).toEqual([90, 30, 31, 60]);
  });
});

describe('bridgeGaps', () => {
  it('runs straight across a gap and leaves the readings and open ends alone', () => {
    expect(bridgeGaps([0, 1, 2, 4, 5, 6], [null, 10, null, null, 40, null])).toEqual([
      null,
      10,
      17.5,
      32.5,
      40,
      null,
    ]);
    expect(bridgeGaps([0, 1, 2], [1, 2, 3])).toEqual([null, null, null]);
  });
});

describe('timeSplit and daySummaries', () => {
  it('counts whatever isn’t driving or charging as parked', () => {
    const split = timeSplit(
      trip([drive(1)], [], {
        startedAt: local(1, 0),
        endedAt: local(1, 12),
        drivingSeconds: 3600,
        chargingSeconds: 3600,
      }),
    );
    expect(split).toEqual({
      drivingS: 3600,
      chargingS: 3600,
      missingS: 0,
      parkedS: 36000,
      totalS: 43200,
    });
    expect(timeSplit(trip([], [], { startedAt: null, endedAt: null }))).toBeNull();
  });

  it('counts the time between drives that don’t meet as not in the trip, less any charging', () => {
    const split = timeSplit(
      trip(
        [
          drive(1, { startedAt: local(1, 8), endedAt: local(1, 9) }),
          drive(2, { startedAt: local(1, 13), endedAt: local(1, 14) }),
        ],
        [charge(1, { startedAt: local(1, 10), endedAt: local(1, 11), chargingSeconds: 3600 })],
        {
          startedAt: local(1, 8),
          endedAt: local(1, 14),
          drivingSeconds: 7200,
          chargingSeconds: 3600,
        },
      ),
    );
    // Four hours between the drives, one of them charging.
    expect(split).toMatchObject({ missingS: 3 * 3600, parkedS: 0 });
  });

  it('doesn’t take time between drives that don’t meet as a night anywhere', () => {
    const ds = [
      drive(1, { end: place('Jumbo Rocks') }),
      drive(2, { start: place('Somewhere else'), end: place('Home') }),
    ];
    expect(tripStays(ds, [])).toEqual([]);
  });

  it('adds up each day, and won’t add up two currencies', () => {
    const days = daySummaries(
      [drive(1), drive(2)],
      [
        charge(1, { cost: '10', estimatedCost: null, currency: 'USD', energyKwh: 30 }),
        charge(2, { cost: '12', estimatedCost: null, currency: 'CAD', energyKwh: 20 }),
      ],
    );
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ distanceKm: 200, energyAddedKwh: 50, cost: null });
    expect(days[1]!.from).toBe('San Diego');
  });
});
