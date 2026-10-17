import { describe, expect, it } from 'vitest';
import { b64, double, float, graphBar, int, message, string } from '../../testing/protobuf.js';
import {
  RVM_BATTERY_STATE,
  RVM_CABIN_TEMPERATURES,
  RVM_CLOSURES,
  RVM_DEFROST,
  RVM_GEAR,
  RVM_LOCKS,
  RVM_LOW_VOLTAGE_BATTERY,
  RVM_ODOMETER,
  RVM_OTA_DEPLOYMENT,
  RVM_POWER,
  RVM_PRECONDITIONING,
  RVM_RANGE,
  RVM_SOC_SLIDER,
  chargerStateFromStatus,
  chargerStatusFromStatus,
  chargingWindowSchedule,
  decodeBatteryCharacteristics,
  decodeBatteryState,
  decodeChargeBreakdown,
  decodeChargingGraph,
  decodeChargingGraphBar,
  decodeChargingStatus,
  decodeChargingWindow,
  decodeColdWeather,
  decodeGnss,
  decodeNetwork,
  decodeParkedEnergy,
  decodeSocSlider,
  decodeTimeEstimation,
  decodeTires,
  decodePolyline,
  decodeTripInfo,
  decodeTripProgress,
  describeParallax,
  fieldsOf,
  readProtoFields,
  vehicleStateFromParallax,
  vehicleSupportsParallax,
} from './index.js';

const START = Date.parse('2026-10-01T07:00:00Z');
const bar = graphBar;

describe('decodeBatteryCharacteristics', () => {
  it('reads reported and rated capacity independently from a captured payload', () => {
    expect(decodeBatteryCharacteristics('LaSw30I1AADcQg==')).toEqual({
      capacityKwh: 111.845,
      ratedCapacityKwh: 110,
    });
    expect(decodeBatteryCharacteristics(b64(float(6, 110)))).toEqual({
      capacityKwh: null,
      ratedCapacityKwh: 110,
    });
    expect(decodeBatteryCharacteristics(b64(float(5, 111)))).toEqual({
      capacityKwh: 111,
      ratedCapacityKwh: null,
    });
  });

  it('rejects absent, malformed, wrong-type and invalid capacity readings', () => {
    for (const payload of [
      '',
      'LQ==',
      b64(int(5, 110)),
      ...[0, -1, NaN, Infinity, 501].map((n) => b64(float(5, n))),
    ]) {
      expect(decodeBatteryCharacteristics(payload)).toBeNull();
    }
  });
  it('does not replace missing or invalid rated capacity with the reported estimate', () => {
    for (const value of [0, -1, NaN, Infinity, 501]) {
      expect(decodeBatteryCharacteristics(b64([...float(5, 111), ...float(6, value)]))).toEqual({
        capacityKwh: 111,
        ratedCapacityKwh: null,
      });
    }
    expect(decodeBatteryCharacteristics(b64([...float(5, 111), ...int(6, 110)]))).toEqual({
      capacityKwh: 111,
      ratedCapacityKwh: null,
    });
  });
});

describe('readProtoFields', () => {
  it('reads varint, fixed32 and length-delimited fields', () => {
    const fields = readProtoFields(
      new Uint8Array([...int(1, 300), ...float(2, 1.5), ...message(3, [0x41])]),
    );
    expect(fields?.map((f) => [f.field, f.wire])).toEqual([
      [1, 0],
      [2, 5],
      [3, 2],
    ]);
  });

  it('rejects truncated or invalid bytes', () => {
    expect(readProtoFields(new Uint8Array([0x0a, 0x05, 0x01]))).toBeNull(); // length past the end
    expect(readProtoFields(new Uint8Array([0x0b]))).toBeNull(); // group wire type
  });

  it('reads each message of a repeated field, in order, skipping other wire types', () => {
    const m = fieldsOf(
      new Uint8Array([
        ...message(1, int(1, 7)),
        ...int(1, 3), // a varint where a message belongs
        ...message(2, int(1, 8)),
        ...message(1, int(1, 9)),
      ]),
    );
    expect(m?.repeated(1).map((e) => e.int(1))).toEqual([7, 9]);
    expect(m?.repeated(5)).toEqual([]);
  });
});

describe('decodeChargingGraphBar', () => {
  it("decodes SOC, power and the bar's time span", () => {
    const decoded = decodeChargingGraphBar(new Uint8Array(bar(42, 11.25, START, START + 60_000)));
    expect(decoded).toEqual({
      soc: 42,
      powerKw: 11.25,
      startMs: START,
      endMs: START + 60_000,
      chargingState: 3,
    });
  });

  it('treats a missing power as unknown, never 0 kW, and needs a sane start', () => {
    expect(
      decodeChargingGraphBar(new Uint8Array([...int(1, 80), ...int(3, START)]))?.powerKw,
    ).toBeNull();
    expect(decodeChargingGraphBar(new Uint8Array([...int(1, 80), ...int(3, 12345)]))).toBeNull();
  });

  it('drops readings outside physical ranges', () => {
    const bad = decodeChargingGraphBar(
      new Uint8Array([...int(1, 140), ...float(2, 9000), ...int(3, START)]),
    );
    expect(bad).toMatchObject({ soc: null, powerKw: null });
  });
});

describe('decodeChargingGraph', () => {
  it('collects the bars repeated in field 1, in time order', () => {
    const payload = b64([
      ...message(1, bar(41, 11, START + 60_000, START + 120_000)),
      ...message(1, bar(40, 10.5, START, START + 60_000)),
      ...message(5, [...int(1, 7)]), // some other submessage: not a bar
    ]);
    expect(decodeChargingGraph(payload).map((b) => [b.soc, b.powerKw])).toEqual([
      [40, 10.5],
      [41, 11],
    ]);
  });

  it('ignores other submessages that happen to decode as bars', () => {
    // A stray SoC-and-time message outside field 1 became a 0 kW point at
    // the wrong SoC on a DC charge.
    const payload = b64([
      ...message(1, bar(64, 124.7, START, START + 4_000)),
      ...message(2, [...int(1, 57), ...int(3, START + 1_000)]),
    ]);
    expect(decodeChargingGraph(payload).map((b) => [b.soc, b.powerKw])).toEqual([[64, 124.7]]);
  });

  it('returns nothing for empty or malformed payloads', () => {
    expect(decodeChargingGraph('')).toEqual([]);
    expect(decodeChargingGraph(b64([0x0a, 0x09]))).toEqual([]);
  });
});

// Payloads below mirror a live R1S capture's field layout and values.
describe('decodeChargeBreakdown', () => {
  it("splits a session's energy and reads its charging time and range", () => {
    const payload = b64([
      ...float(1, 35.8),
      ...float(2, 34.4),
      ...float(5, 1.4),
      ...int(6, 313),
      ...int(8, 162),
      ...message(11, []),
      ...int(12, 1),
      ...int(13, 1),
    ]);
    expect(decodeChargeBreakdown(payload)).toEqual({
      totalKwh: 35.8,
      packKwh: 34.4,
      thermalKwh: 1.4,
      chargingMinutes: 313,
      rangeAddedKm: 162,
      cost: null,
      // A finished session's breakdown carries no live readings: unknown, not 0.
      powerKw: null,
      rangeKmPerHour: null,
      minutesRemaining: 0,
    });
  });

  it('reads live power, range rate and time left from a charge in progress', () => {
    // Captured from a home L2 charge at 90.3% with a 95% limit.
    expect(decodeChargeBreakdown('DZmZJUIVMzMfQi3NzMw/MOsCOCpAwgFNzczsQFAfWgBgAWgD')).toMatchObject(
      {
        totalKwh: 41.4,
        packKwh: 39.8,
        thermalKwh: 1.6,
        chargingMinutes: 363,
        minutesRemaining: 42,
        rangeAddedKm: 194,
        powerKw: 7.4,
        rangeKmPerHour: 31,
      },
    );
  });

  it('reads a session cost', () => {
    const payload = b64([
      ...float(1, 53),
      ...message(11, [...string(1, 'USD'), ...int(2, 37), ...int(3, 810_000_000)]),
    ]);
    expect(decodeChargeBreakdown(payload)?.cost).toEqual({ amount: 37.81, currency: 'USD' });
  });

  it('returns null for an empty payload', () => {
    expect(decodeChargeBreakdown('')).toBeNull();
  });
});

describe('decodeBatteryState', () => {
  it('reads SOC and capacity, and cell temperatures when awake', () => {
    const asleep = b64([
      ...message(1, [...double(1, 69.9), ...double(2, 111.285)]),
      ...message(3, []),
    ]);
    expect(decodeBatteryState(asleep)).toEqual({
      soc: 69.9,
      capacityKwh: 111.285,
      cellTemps: null,
    });
    const awake = decodeBatteryState(
      b64([
        ...message(1, [...double(1, 58.2)]),
        ...message(2, [...float(1, 42.8), ...float(2, 46.6), ...float(3, 37.2)]),
      ]),
    );
    expect(awake?.cellTemps).toEqual({ avgC: 42.8, maxC: 46.6, minC: 37.2 });
  });
});

describe('decodeColdWeather', () => {
  it('treats omitted fields as no cold impact', () => {
    expect(decodeColdWeather(b64(int(1, 70)))).toEqual({
      usableSoc: 70,
      coldSoc: 0,
      rangeImpactKm: 0,
    });
  });
});

describe('decodeParkedEnergy', () => {
  it('identifies outlets from the captured outlet-use sample', () => {
    const windows = decodeParkedEnergy(
      'CisNzcwMQBUAAAA/Hc3MzD0lzszMPzVeDCpBPeGWGkBFz1f3Pk3QV/dAWKALEisNAQDAPxWamZk+Hc3MzD0lzcyMPzVT4udAPduBuT9Fz1f3Pk1eDKpAWOADGhYNzczMPSXNzMw9Nc9X9z5Nz1f3Plhv',
    );
    expect(windows.map((w) => ({ minutes: w.minutes, uses: w.uses }))).toEqual([
      { minutes: 1440, uses: { climate: 0.5, system: 1.6, gearGuard: 0, outlets: 0.1 } },
      { minutes: 480, uses: { climate: 0.3, system: 1.1, gearGuard: 0, outlets: 0.1 } },
      { minutes: 111, uses: { climate: 0, system: 0.1, gearGuard: 0, outlets: 0 } },
    ]);
  });

  it('keeps simultaneous Gear Guard and outlet usage separate', () => {
    const payload = b64(
      message(1, [...float(1, 0.7), ...float(3, 0.2), ...float(5, 0.5), ...int(11, 1440)]),
    );
    expect(decodeParkedEnergy(payload)[0]?.uses).toEqual({
      climate: 0,
      system: 0,
      gearGuard: 0.5,
      outlets: 0.2,
    });
  });

  it("reads each window's energy, range and length", () => {
    const window = (kwh: number, km: number, minutes: number) => [
      ...float(1, kwh),
      ...float(2, 0.3),
      ...float(4, 0.8),
      ...float(6, km),
      ...float(7, 1.449),
      ...float(9, 3.865),
      ...int(11, minutes),
    ];
    const payload = b64([
      ...message(1, window(1.1, 5.314, 1440)),
      ...message(2, window(0.4, 1.932, 480)),
    ]);
    const uses = { climate: 0.3, system: 0.8, gearGuard: 0, outlets: 0 };
    expect(decodeParkedEnergy(payload)).toEqual([
      { minutes: 1440, kwh: 1.1, rangeKm: 5.314, uses },
      { minutes: 480, kwh: 0.4, rangeKm: 1.932, uses },
    ]);
  });

  it('splits energy by use, matching the Rivian app', () => {
    // Captured; the app showed climate 0.4, system 1.7, Gear Guard and outlets 0 kWh.
    const [day] = decodeParkedEnergy(
      'CiENZ2YGQBXNzMw+JZuZ2T81oFEiQT3PV/c/TaZmA0FYoAsSIQ3OzEw/Fc3MzD0lNDMzPzXQV3dAPc9X9z5N1mxYQFjgAxoCWB0=',
    );
    expect(day?.uses).toEqual({ climate: 0.4, system: 1.7, gearGuard: 0, outlets: 0 });
  });
});

describe('decodeNetwork', () => {
  it('reads the Wi-Fi network and cellular carrier', () => {
    const payload = b64([
      ...int(1, 1),
      ...message(2, [...int(1, 1), ...int(2, 2)]),
      ...message(4, [
        ...int(1, 2),
        ...int(2, 2),
        ...string(3, 'fatcat'),
        ...int(7, 3),
        ...int(8, -66),
        ...int(9, 72),
        ...int(10, 5240),
      ]),
      ...message(5, [...string(1, 'AT&T'), ...string(2, 'LTE'), ...int(3, 3), ...int(4, -255)]),
    ]);
    expect(decodeNetwork(payload)).toEqual({
      wifi: { ssid: 'fatcat', rssiDbm: -66, frequencyMhz: 5240 },
      cellular: { carrier: 'AT&T', technology: 'LTE' },
    });
  });

  it('reports no Wi-Fi without an SSID', () => {
    expect(decodeNetwork(b64(message(4, [...int(1, 1)])))?.wifi).toBeNull();
  });
});

// Field layout from a live navigation trip (location and address changed).
describe('decodeTripInfo / decodeTripProgress', () => {
  const stop = message(1, [
    ...message(1, [...double(1, 40.4842), ...double(2, -88.9937)]),
    ...message(2, [...double(1, 40.4842), ...double(2, -88.9937)]),
    ...int(3, 2),
    ...string(4, '100 Main St'),
    ...string(5, 'place-id'),
    ...double(7, 63.27),
  ]);
  const tripInfo = b64([
    ...string(1, '-6117841862812636333'),
    ...message(2, [...message(1, [...double(1, 40.5), ...double(2, -89)]), ...float(3, 5.9)]),
    ...message(3, [
      ...double(1, 30837),
      ...double(2, 2242),
      ...message(3, stop),
      ...message(4, string(3, 'Via I-5 S')),
    ]),
    ...double(5, 69.8),
    ...double(6, 63.259),
    ...double(7, 339440.3),
  ]);

  it('reads the destination, route length and predicted arrival', () => {
    expect(decodeTripInfo(tripInfo)).toEqual({
      destination: { name: '100 Main St', lat: 40.4842, lon: -88.9937 },
      totalDistanceKm: 30.837,
      totalDurationS: 2242,
      arrivalSoc: 63.259,
      arrivalRangeKm: 339.4403,
      arrivalAtMs: null,
      route: null,
    });
  });

  // As an R1S sent it on 2026-10-14: arrival inside the route, with its line.
  const routed = (extra: number[]) =>
    b64([
      ...string(1, '-6169720410367716421'),
      ...message(3, [
        ...double(1, 24400),
        ...double(2, 2114),
        ...message(
          3,
          message(1, [
            ...message(1, [...double(1, 33.0758654), ...double(2, -117.2598958)]),
            ...string(4, 'El Camino Creek Elementary'),
            ...double(7, 57.48),
            ...double(8, 308577.3),
            ...message(9, int(1, 1792020295)),
          ]),
        ),
        ...double(6, 57.48),
        ...double(7, 308577.3),
        ...extra,
      ]),
      ...double(5, 63),
      ...message(6, int(1, 1792020295)),
    ]);
  // Google's own example: (38.5, -120.2), (40.7, -120.95), (43.252, -126.453).
  const line = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
  const points = [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ];

  it('reads arrival and the planned route from the route, as the vehicle sends them now', () => {
    expect(decodeTripInfo(routed(string(10, line)))).toEqual({
      destination: { name: 'El Camino Creek Elementary', lat: 33.0758654, lon: -117.2598958 },
      totalDistanceKm: 24.4,
      totalDurationS: 2114,
      arrivalSoc: 57.48,
      arrivalRangeKm: 308.5773,
      arrivalAtMs: 1792020295000,
      route: points,
    });
  });

  // Each leg's line is encoded on its own.
  it("joins the legs' lines when the route has no line of its own", () => {
    const legs = [...message(4, string(4, '_p~iF~ps|U')), ...message(4, string(4, '_flwFn`faV'))];
    expect(decodeTripInfo(routed(legs))?.route).toEqual(points.slice(0, 2));
    expect(decodeTripInfo(routed([]))?.route).toBeNull();
  });

  it('stops at a cut-off polyline', () => {
    expect(decodePolyline(line)).toEqual(points);
    expect(decodePolyline(line.slice(0, -2))).toEqual(points.slice(0, 2));
    expect(decodePolyline('')).toEqual([]);
  });

  it('is null when not navigating', () => {
    expect(decodeTripInfo('')).toBeNull();
  });

  it("reads ETA and what's left", () => {
    const progress = b64([
      ...message(1, int(1, 1790869380)),
      ...message(2, int(1, 1790869380)),
      ...double(4, 30506),
      ...double(5, 2220),
      ...message(6, [...message(1, [...double(1, 40.5), ...double(2, -89)]), ...float(2, 7.9)]),
    ]);
    expect(decodeTripProgress(progress)).toEqual({
      etaMs: 1790869380000,
      remainingKm: 30.506,
      remainingS: 2220,
    });
  });
});

describe('decodeChargingStatus', () => {
  it('reads the enums, with omitted ones as 0', () => {
    expect(decodeChargingStatus(b64([...int(1, 2), ...int(3, 1)]))).toEqual({
      plugConnection: 2,
      displayStatus: 0,
      evseType: 1,
    });
    expect(decodeChargingStatus('')).toBeNull();
  });
});

describe('decodeChargingWindow', () => {
  // As an R1S sent it, but with made-up coordinates: Saturday's window,
  // midnight (left out) to 14:00 at 32 A.
  const window = (fields: number[]) =>
    b64([
      ...int(1, 1),
      ...message(2, [
        ...fields,
        ...int(4, 32),
        ...message(5, [...double(1, 33), ...double(2, -117)]),
      ]),
    ]);
  const saturday = window([...int(2, 840), ...int(3, 840), ...int(6, 7), ...int(7, 7)]);

  it('reads the next window, with Sunday as day 1', () => {
    expect(decodeChargingWindow(saturday)).toEqual({
      startDay: 7,
      startMinute: 0,
      endDay: 7,
      endMinute: 840,
      amps: 32,
      latitude: 33,
      longitude: -117,
    });
    expect(chargingWindowSchedule(decodeChargingWindow(saturday)!)).toEqual({
      enabled: true,
      startTime: 0,
      duration: 840,
      amperage: 32,
      weekDays: ['Saturday'],
      location: { latitude: 33, longitude: -117 },
    });
    expect(decodeChargingWindow('')).toBeNull();
  });

  it('reads a window that runs past midnight into the next day', () => {
    const overnight = decodeChargingWindow(
      window([...int(1, 1380), ...int(2, 360), ...int(6, 6), ...int(7, 7)]),
    )!;
    expect(chargingWindowSchedule(overnight)).toMatchObject({
      startTime: 1380,
      duration: 420,
      weekDays: ['Friday'],
    });
  });
});

describe('decodeTimeEstimation', () => {
  it('reads the hold time in seconds', () => {
    expect(decodeTimeEstimation(b64(int(1, 5400)))).toEqual({
      holdTimeSeconds: 5400,
      minutesRemaining: 0,
    });
  });

  it('reads minutes remaining from a live charge', () => {
    expect(decodeTimeEstimation(b64(int(2, 42)))).toEqual({
      holdTimeSeconds: 0,
      minutesRemaining: 42,
    });
    expect(decodeTimeEstimation('')).toBeNull();
  });
});

describe('decodeSocSlider', () => {
  it('reads the charge limit', () => {
    expect(decodeSocSlider('CF8=')).toEqual({ limit: 95 }); // captured
    expect(decodeSocSlider('')).toBeNull();
  });
});

describe('chargerStateFromStatus', () => {
  it('maps the display statuses seen on a live charge', () => {
    // Captured: scheduled, connecting, charging, complete, and stopped from the app.
    expect(
      ['CAIQBRgB', 'CAIQAhgB', 'CAIQAxgB', 'CAIQBBgB', 'CAIQCBgB'].map((p) =>
        chargerStateFromStatus(decodeChargingStatus(p)!),
      ),
    ).toEqual([
      'charging_scheduled',
      'charging_connecting',
      'charging_active',
      'charging_complete',
      'charging_user_stopped',
    ]);
    expect(chargerStateFromStatus({ plugConnection: 2, displayStatus: 9, evseType: 1 })).toBeNull();
  });

  it('reads 1 as ready only while unplugged', () => {
    expect(chargerStateFromStatus(decodeChargingStatus('CAEQAQ==')!)).toBe('charging_ready');
    // Sent just after plugging in, while legacy says connecting or scheduled.
    expect(chargerStateFromStatus(decodeChargingStatus('CAIQAQ==')!)).toBeNull();
  });

  it('supplies charger state as well as plug state', () => {
    const TS = '2026-10-14T02:04:12.000Z';
    const rvm = 'charging.session.status';
    expect(vehicleStateFromParallax(rvm, 'CAIQCBgB', TS)).toEqual({
      chargerStatus: { timeStamp: TS, value: 'chrgr_sts_connected_no_chrg' },
      chargerState: { timeStamp: TS, value: 'charging_user_stopped' },
    });
    expect(vehicleStateFromParallax(rvm, 'CAIQAQ==', TS)).toEqual({
      chargerStatus: { timeStamp: TS, value: 'chrgr_sts_connected_no_chrg' },
    });
  });
});

describe('vehicleSupportsParallax', () => {
  it('is true only when VEHICLE_CONNECTIVITY_PARALLAX is present', () => {
    expect(vehicleSupportsParallax(['VEHICLE_CONNECTIVITY_PARALLAX', 'OTHER'])).toBe(true);
    expect(vehicleSupportsParallax(['OTHER'])).toBe(false);
    expect(vehicleSupportsParallax([])).toBe(false);
    expect(vehicleSupportsParallax(null)).toBe(false);
    expect(vehicleSupportsParallax(undefined)).toBe(false);
  });
});

describe('decodeGnss', () => {
  it('reads latitude/longitude/altitude', () => {
    const payload = b64([...double(1, 37.774929), ...double(2, -122.419418), ...double(3, 15.3)]);
    expect(decodeGnss(payload)).toEqual({
      latitude: 37.774929,
      longitude: -122.419418,
      altitude: 15.3,
      bearing: null,
      speedMps: 0, // a fix without speed is a standstill
    });
  });

  it('normalizes a signed -180..180 heading to a 0-360 compass bearing', () => {
    // Captured against a real R2 (2026-09-29): raw -80.6 doesn't fit 0-360,
    // but reads as a plausible heading once treated as signed.
    expect(decodeGnss(b64(float(5, -80.6)))?.bearing).toBeCloseTo(279.4, 1);
    expect(decodeGnss(b64(float(5, 45)))?.bearing).toBeCloseTo(45, 1);
  });

  it('reads speed in m/s from field 4, and field 6 not at all', () => {
    // As captured from an R1S beside legacy gnssSpeed: 22.13 at 22.27 m/s,
    // with field 6 at 0.601; and parked, with field 6 at 0.722 and no field 4.
    const fix = [...double(1, 33), ...double(2, -117)];
    expect(decodeGnss(b64([...fix, ...float(4, 22.13), ...float(6, 0.601)]))?.speedMps).toBeCloseTo(
      22.13,
      2,
    );
    expect(decodeGnss(b64([...fix, ...float(6, 0.722)]))?.speedMps).toBe(0);
    // No fix at all says nothing about speed.
    expect(decodeGnss(b64(float(5, 45)))?.speedMps).toBeNull();
  });

  it('returns null for an empty payload', () => {
    expect(decodeGnss('')).toBeNull();
  });
});

describe('decodeTires', () => {
  const tire = (pos: number, status: number, bar: number) =>
    message(2, [...int(1, pos), ...int(2, status), ...double(3, bar)]);

  it('reads position, status and pressure (bar) for each tire', () => {
    const payload = b64([
      ...tire(1, 1, 2.8),
      ...tire(2, 1, 2.85),
      ...tire(3, 2, 2.75),
      ...tire(4, 1, 2.8),
    ]);
    expect(decodeTires(payload)).toEqual([
      { position: 'FrontLeft', pressureBar: 2.8, status: 'OK' },
      { position: 'FrontRight', pressureBar: 2.85, status: 'OK' },
      { position: 'RearLeft', pressureBar: 2.75, status: 'Warning' },
      { position: 'RearRight', pressureBar: 2.8, status: 'OK' },
    ]);
  });

  it('returns [] for an empty payload', () => {
    expect(decodeTires('')).toEqual([]);
  });
});

describe('describeParallax', () => {
  it('lists every field by path, with names for those the decoders read', () => {
    const payload = b64([
      ...message(3, [
        ...double(1, 30800),
        // Two stops: repeated fields get an index; the stop's address is non-ASCII text.
        ...message(3, [...message(1, [...message(1, [...double(1, 34.4), ...double(2, -119.8)])])]),
        ...message(3, [...message(1, [...string(4, 'Café, Goleta')])]),
      ]),
      ...int(9, -60),
      ...float(10, 1.5),
    ]);
    expect(
      describeParallax({
        rvm: 'navigation.navigation_service.trip_info',
        payload,
        timestamp: null,
      }),
    ).toEqual([
      { path: '3.1', name: 'Route distance (m)', value: 30800 },
      { path: '3.3[0].1.1.1', name: 'Stop latitude', value: 34.4 },
      { path: '3.3[0].1.1.2', name: 'Stop longitude', value: -119.8 },
      { path: '3.3[1].1.4', name: 'Stop address', value: 'Café, Goleta' },
      { path: '9', name: null, value: -60 },
      { path: '10', name: null, value: 1.5 },
    ]);
  });

  it('matches names through repeated windows, and is empty for an empty payload', () => {
    const payload = b64([...message(2, [...float(1, 0.4), ...int(11, 1440)])]);
    expect(
      describeParallax({
        rvm: 'energy_edge_compute.graphs.parked_energy_distributions',
        payload,
        timestamp: null,
      }),
    ).toEqual([
      { path: '2.1', name: 'Window: total energy (kWh)', value: 0.4 },
      { path: '2.11', name: 'Window: length (minutes)', value: 1440 },
    ]);
    expect(describeParallax({ rvm: 'x', payload: '', timestamp: null })).toEqual([]);
  });

  it('names each closure entry after what its position is', () => {
    const entry = (position: number, state: number) =>
      message(1, [...int(1, position), ...int(2, state)]);
    const payload = b64([...entry(1, 2), ...entry(5, 1), ...entry(99, 2)]);
    expect(describeParallax({ rvm: RVM_CLOSURES, payload, timestamp: null })).toEqual([
      { path: '1[0].1', name: 'Driver door: position', value: 1 },
      {
        path: '1[0].2',
        name: 'Driver door: state (1 open, 2 closed, 3 ajar, 4 opening, 5 closing)',
        value: 2,
      },
      { path: '1[1].1', name: 'Frunk: position', value: 5 },
      {
        path: '1[1].2',
        name: 'Frunk: state (1 open, 2 closed, 3 ajar, 4 opening, 5 closing)',
        value: 1,
      },
      // An unknown position keeps the general name.
      { path: '1[2].1', name: 'Closure: position', value: 99 },
      {
        path: '1[2].2',
        name: 'Closure: state (1 open, 2 closed, 3 ajar, 4 opening, 5 closing)',
        value: 2,
      },
    ]);
  });

  it('names each tire after its position', () => {
    const payload = b64(message(2, [...int(1, 3), ...int(2, 1), ...double(3, 3.1)]));
    expect(
      describeParallax({ rvm: 'dynamics.tires.state', payload, timestamp: null }).map(
        (f) => f.name,
      ),
    ).toEqual([
      'Rear left: position (1–4 = FL, FR, RL, RR)',
      'Rear left: status (1 = OK)',
      'Rear left: pressure (bar)',
    ]);
  });
});

describe('vehicleStateFromParallax', () => {
  const TS = '2026-10-12T13:58:09.952Z';
  const read = (rvm: string, bytes: number[]) => vehicleStateFromParallax(rvm, b64(bytes), TS);
  const v = (value: string | number) => ({ timeStamp: TS, value });
  const entry = (position: number, state?: number) =>
    message(1, [...int(1, position), ...(state == null ? [] : int(2, state))]);

  it('reads power state and gear as legacy values', () => {
    expect(read(RVM_POWER, int(1, 4))).toEqual({ powerState: v('go') });
    expect(read(RVM_POWER, int(1, 1))).toEqual({ powerState: v('sleep') });
    expect(read(RVM_GEAR, int(1, 4))).toEqual({ gearStatus: v('drive') });
    expect(read(RVM_GEAR, int(1, 2))).toEqual({ gearStatus: v('reverse') });
    expect(read(RVM_GEAR, int(1, 1))).toEqual({ gearStatus: v('park') });
  });

  it('skips unknown or missing power states and gears', () => {
    expect(read(RVM_POWER, int(1, 9))).toBeNull();
    expect(read(RVM_GEAR, [])).toBeNull();
    expect(read(RVM_GEAR, int(1, 0))).toBeNull();
  });

  it('reads the odometer (km) as legacy vehicleMileage (m)', () => {
    expect(read(RVM_ODOMETER, int(1, 456))).toEqual({ vehicleMileage: v(456_000) });
    expect(read(RVM_ODOMETER, int(1, 0))).toBeNull();
    expect(read(RVM_ODOMETER, int(1, 3_000_000))).toBeNull();
  });

  it('reads an R2 closure frame: doors, liftgate, windows, rear glass and charge port', () => {
    const state = read(RVM_CLOSURES, [
      ...entry(1, 1), // driver door open
      ...entry(2, 2),
      ...entry(3, 2),
      ...entry(4, 2),
      ...entry(5, 4), // frunk opening
      ...entry(6, 0), // no tailgate on an R2
      ...entry(7, 5), // liftgate closing
      ...entry(10, 2),
      ...entry(12, 1), // window open
      ...entry(13, 2),
      ...entry(14, 2),
      ...entry(15, 2),
      ...entry(16, 1), // rear drop glass open
      ...entry(10000), // stateless marker ending every R2 frame
    ]);
    expect(state).toEqual({
      doorFrontLeftClosed: v('open'),
      doorFrontRightClosed: v('closed'),
      doorRearLeftClosed: v('closed'),
      doorRearRightClosed: v('closed'),
      closureFrunkClosed: v('open'),
      closureLiftgateClosed: v('open'),
      chargePortState: v('close'),
      windowFrontLeftClosed: v('open'),
      windowFrontRightClosed: v('closed'),
      windowRearLeftClosed: v('closed'),
      windowRearRightClosed: v('closed'),
      windowRearGlassClosed: v('open'),
    });
  });

  it('reads the charge port as legacy does (ajar as open), and skips unknown closure states', () => {
    expect(read(RVM_CLOSURES, entry(10, 1))).toEqual({ chargePortState: v('open') });
    expect(read(RVM_CLOSURES, entry(10, 3))).toEqual({ chargePortState: v('open') });
    expect(read(RVM_CLOSURES, entry(10, 4))).toEqual({ chargePortState: v('opening') });
    expect(read(RVM_CLOSURES, entry(10, 5))).toEqual({ chargePortState: v('closing') });
    expect(read(RVM_CLOSURES, [...entry(1, 9), ...entry(2, 2)])).toEqual({
      doorFrontRightClosed: v('closed'),
    });
    expect(read(RVM_CLOSURES, entry(20, 2))).toBeNull();
  });

  it('reads doors and windows only as open or closed', () => {
    expect(
      read(RVM_CLOSURES, [...entry(1, 3), ...entry(2, 4), ...entry(3, 5), ...entry(4, 1)]),
    ).toEqual({ doorRearRightClosed: v('open') });
    expect(
      read(RVM_CLOSURES, [
        ...entry(12, 3),
        ...entry(13, 4),
        ...entry(14, 5),
        ...entry(15, 2),
        ...entry(16, 1),
      ]),
    ).toEqual({ windowRearRightClosed: v('closed'), windowRearGlassClosed: v('open') });
    // Other closures still read ajar, opening and closing as open.
    expect(read(RVM_CLOSURES, [...entry(5, 3), ...entry(7, 5)])).toEqual({
      closureFrunkClosed: v('open'),
      closureLiftgateClosed: v('open'),
    });
  });

  it('reads locks, skipping unmapped positions and unknown states', () => {
    expect(
      read(RVM_LOCKS, [
        ...entry(1, 1),
        ...entry(2, 2),
        ...entry(5, 3), // partly unlocked: not seen yet, so not read
        ...entry(7, 1),
        ...entry(14, 1), // no legacy field
        ...entry(3, 7), // unknown state
      ]),
    ).toEqual({
      doorFrontLeftLocked: v('locked'),
      doorFrontRightLocked: v('unlocked'),
      closureLiftgateLocked: v('locked'),
    });
  });

  it('reads cabin temperatures, skipping implausible ones', () => {
    expect(read(RVM_CABIN_TEMPERATURES, [...float(3, 23.5), ...float(4, 21)])).toEqual({
      cabinClimateInteriorTemperature: v(23.5),
      cabinClimateDriverTemperature: v(21),
    });
    expect(read(RVM_CABIN_TEMPERATURES, float(3, 500))).toBeNull();
  });

  it('reads preconditioning (an empty message is off) and defrost, spelled as legacy does', () => {
    expect(read(RVM_PRECONDITIONING, [])).toEqual({
      cabinPreconditioningStatus: v('undefined'),
    });
    expect(read(RVM_PRECONDITIONING, int(1, 4))).toEqual({
      cabinPreconditioningStatus: v('active'),
    });
    expect(read(RVM_PRECONDITIONING, int(1, 2))).toEqual({
      cabinPreconditioningStatus: v('initiate'),
    });
    expect(read(RVM_DEFROST, int(1, 2))).toEqual({ defrostDefogStatus: v('On') });
    expect(read(RVM_DEFROST, int(1, 4))).toEqual({ defrostDefogStatus: v('Off') });
    expect(read(RVM_DEFROST, int(1, 3))).toBeNull();
  });

  it('reads battery state and the charge limit as legacy battery fields', () => {
    // Captured from an R1S, matching its legacy batteryLevel, batteryCapacity
    // and batteryLimit (52.4, 111.33, 70).
    const battery = read(RVM_BATTERY_STATE, [
      ...message(1, [...double(1, 52.4), ...double(2, 111.33)]),
      ...message(3, []),
    ]);
    expect(battery).toEqual({ batteryLevel: v(52.4), batteryCapacity: v(111.33) });
    expect(vehicleStateFromParallax(RVM_SOC_SLIDER, 'CEY=', TS)).toEqual({
      batteryLimit: v(70),
    });
  });

  it('skips battery readings out of range or missing', () => {
    expect(read(RVM_BATTERY_STATE, message(1, [...double(1, 140), ...double(2, 900)]))).toBeNull();
    expect(read(RVM_BATTERY_STATE, message(2, [...float(1, 42.8)]))).toBeNull();
    expect(read(RVM_SOC_SLIDER, int(1, 0))).toBeNull();
  });

  it('reads range and 12V health as legacy distanceToEmpty and twelveVoltBatteryHealth', () => {
    // Captured from an R1S beside legacy distanceToEmpty 282 and NORMAL_OPERATION.
    expect(vehicleStateFromParallax(RVM_RANGE, 'CJoCEAEYAQ==', TS)).toEqual({
      distanceToEmpty: v(282),
    });
    expect(vehicleStateFromParallax(RVM_LOW_VOLTAGE_BATTERY, 'CAE=', TS)).toEqual({
      twelveVoltBatteryHealth: v('NORMAL_OPERATION'),
    });
  });

  it('skips range without the field 2 seen so far, and unknown 12V values', () => {
    expect(read(RVM_RANGE, int(1, 282))).toBeNull();
    expect(read(RVM_RANGE, [...int(1, 282), ...int(2, 2)])).toBeNull();
    expect(read(RVM_LOW_VOLTAGE_BATTERY, int(1, 3))).toBeNull();
  });

  it('reads the installed software version from deployment state', () => {
    // Captured from an R1S 15 s after legacy reported 2026.36.0 installed.
    const installed = 'CjQIARIaCgkyMDI2LjM2LjAY6g8gJDIIZDJmNzM0NzQiFCoSCAEQARoCEAAiAhAAKgAweEAC';
    expect(vehicleStateFromParallax(RVM_OTA_DEPLOYMENT, installed, TS)).toEqual({
      otaCurrentVersion: v('2026.36.0'),
    });
  });

  it('skips deployments in other states, and malformed versions', () => {
    const deployment = (state: number, version: string) =>
      message(1, [...int(1, state), ...message(2, string(1, version))]);
    expect(read(RVM_OTA_DEPLOYMENT, deployment(2, '2026.40.0'))).toBeNull();
    expect(read(RVM_OTA_DEPLOYMENT, deployment(1, 'VehicleOTAState'))).toBeNull();
  });

  it('ignores other topics and malformed payloads', () => {
    expect(read('dynamics.vehicle.gnss', int(1, 1))).toBeNull();
    expect(vehicleStateFromParallax(RVM_GEAR, '/w==', TS)).toBeNull();
  });
});

describe('chargerStatusFromStatus', () => {
  it('reads the plug connection as legacy chargerStatus', () => {
    // Captured from an R2 as it was unplugged (October 8, 2026).
    expect(chargerStatusFromStatus(decodeChargingStatus('CAEQAQ==')!)).toBe(
      'chrgr_sts_not_connected',
    );
    const status = (plugConnection: number, displayStatus: number) => ({
      plugConnection,
      displayStatus,
      evseType: 1,
    });
    expect(chargerStatusFromStatus(status(2, 3))).toBe('chrgr_sts_connected_charging');
    expect(chargerStatusFromStatus(status(2, 2))).toBe('chrgr_sts_connected_no_chrg');
    expect(chargerStatusFromStatus(status(2, 4))).toBe('chrgr_sts_connected_no_chrg');
    expect(chargerStatusFromStatus(status(0, 0))).toBeNull();
  });
});
