import { describe, expect, it } from 'vitest';
import {
  LookupRejectedError,
  conditionsAt,
  RateLimitedError,
  interpolateAt,
  openMeteoTemperatures,
  parseOpenMeteo,
  sampleTrack,
  summarizeWeather,
  timeWeightedAverage,
} from './drive-weather.js';

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 15, minutes));
const point = (minutes: number, lat = 40) => ({ ts: at(minutes), lat, lon: -89 });

describe('sampleTrack', () => {
  it('keeps the first point, then one every interval, and the last when asked', () => {
    const track = [0, 1, 2, 3, 4, 5.5, 6, 7, 8].map((m) => point(m));
    const minutes = (ps: { ts: Date }[]) => ps.map((p) => p.ts.getUTCMinutes());
    expect(minutes(sampleTrack(track, 3 * 60_000, false))).toEqual([0, 3, 6]);
    expect(minutes(sampleTrack(track, 3 * 60_000, true))).toEqual([0, 3, 6, 8]);
  });

  it('keeps the same samples as the track grows', () => {
    const track = [0, 2, 3.5, 5, 7].map((m) => point(m));
    const early = sampleTrack(track.slice(0, 3), 3 * 60_000, false);
    const later = sampleTrack(track, 3 * 60_000, false);
    expect(later.slice(0, early.length)).toEqual(early);
  });

  it('handles an empty or single-point track', () => {
    expect(sampleTrack([], 60_000, true)).toEqual([]);
    expect(sampleTrack([point(0)], 60_000, true)).toHaveLength(1);
  });
});

describe('interpolateAt', () => {
  const series = { times: [at(0), at(15)].map((d) => d.getTime()), tempsC: [10, 13] };

  it('is linear between values and exact on them', () => {
    expect(interpolateAt(series, at(5).getTime())).toBeCloseTo(11);
    expect(interpolateAt(series, at(15).getTime())).toBe(13);
  });

  it('uses the nearest value up to an hour past either end, then gives up', () => {
    expect(interpolateAt(series, at(-30).getTime())).toBe(10);
    expect(interpolateAt(series, at(60).getTime())).toBe(13);
    expect(interpolateAt(series, at(90).getTime())).toBeNull();
    expect(interpolateAt({ times: [], tempsC: [] }, at(0).getTime())).toBeNull();
  });
});

describe('conditionsAt', () => {
  const series = {
    times: [at(0), at(15)].map((d) => d.getTime()),
    tempsC: [10, 13],
    windKmh: [10, 20],
    windDirDeg: [180, 200],
    codes: [0, 61],
  };

  it('takes the nearest model step', () => {
    expect(conditionsAt(series, at(5).getTime())).toEqual({
      windKmh: 10,
      windDirDeg: 180,
      weatherCode: 0,
    });
    expect(conditionsAt(series, at(10).getTime()).weatherCode).toBe(61);
  });

  it('is empty without data near the time', () => {
    expect(conditionsAt(series, at(120).getTime()).weatherCode).toBeNull();
    expect(conditionsAt({ times: [at(0).getTime()], tempsC: [1] }, at(0).getTime())).toEqual({
      windKmh: null,
      windDirDeg: null,
      weatherCode: null,
    });
  });
});

describe('timeWeightedAverage', () => {
  it('weights by time, not by sample count', () => {
    // 10° for the first 30 minutes, then three close samples at 20°.
    const samples = [
      { ts: at(0), tempC: 10 },
      { ts: at(30), tempC: 10 },
      { ts: at(31), tempC: 20 },
      { ts: at(32), tempC: 20 },
    ];
    expect(timeWeightedAverage(samples)).toBeCloseTo((10 * 30 + 15 * 1 + 20 * 1) / 32);
  });

  it('averages samples at one moment, and is null without any', () => {
    expect(timeWeightedAverage([{ ts: at(0), tempC: 4 }])).toBe(4);
    expect(timeWeightedAverage([])).toBeNull();
  });
});

describe('summarizeWeather', () => {
  const reading = (
    minutes: number,
    tempC: number,
    weatherCode: number | null,
    windKmh: number | null = 10,
    windDirDeg: number | null = 270,
  ) => ({ ts: at(minutes), tempC, weatherCode, windKmh, windDirDeg });

  it('is null without readings', () => {
    expect(summarizeWeather([])).toBeNull();
  });

  it('takes the average over time, the range, and the commonest conditions', () => {
    const s = summarizeWeather([reading(0, 14, 1), reading(3, 18, 1), reading(6, 16, 3)]);
    expect(s).toMatchObject({ minC: 14, maxC: 18, weatherCode: 1, windKmh: 10 });
    expect(s?.avgC).toBeCloseTo(16.5);
    expect(s?.windFromDeg).toBeCloseTo(270);
  });

  it('names wet weather that lasted a good part of the drive', () => {
    const codes = [2, 2, 2, 61];
    const of = (cs: number[]) => summarizeWeather(cs.map((c, i) => reading(i * 3, 10, c)));
    expect(of(codes)?.weatherCode).toBe(61);
    expect(of([...codes, 2])?.weatherCode).toBe(2);
  });

  it('weights wind direction by speed', () => {
    const s = summarizeWeather([reading(0, 10, 0, 30, 0), reading(3, 10, 0, 5, 90)]);
    expect(s?.windFromDeg).toBeLessThan(10);
    expect(s?.windKmh).toBeCloseTo(17.5);
  });

  it('leaves out what the model has no data for', () => {
    const s = summarizeWeather([reading(0, 10, null, null, null)]);
    expect(s).toMatchObject({ weatherCode: null, windKmh: null, windFromDeg: null });
  });
});

describe('parseOpenMeteo', () => {
  const block = (time: number[], temps: (number | null)[]) => ({ time, temperature_2m: temps });

  it('reads one location as an object and several as an array', () => {
    const one = { minutely_15: block([1000, 1900], [5, 6]) };
    expect(parseOpenMeteo(one, 1)).toMatchObject([
      { times: [1_000_000, 1_900_000], tempsC: [5, 6] },
    ]);
    expect(parseOpenMeteo([one, one], 2)).toHaveLength(2);
    expect(() => parseOpenMeteo([one], 2)).toThrow();
  });

  it('skips gaps and falls back to hourly without 15-minute values', () => {
    const body = {
      minutely_15: block([1000, 1900], [null, null]),
      hourly: block([0, 3600], [7, null]),
    };
    expect(parseOpenMeteo(body, 1)).toMatchObject([{ times: [0], tempsC: [7] }]);
  });

  it('lines wind and weather codes up with the temperatures', () => {
    const body = {
      minutely_15: {
        time: [1000, 1900, 2800],
        temperature_2m: [5, null, 6],
        wind_speed_10m: [12, 13, null],
        wind_direction_10m: [270, 280, 290],
        weather_code: [3, 61, 61],
      },
    };
    expect(parseOpenMeteo(body, 1)).toEqual([
      {
        times: [1_000_000, 2_800_000],
        tempsC: [5, 6],
        windKmh: [12, null],
        windDirDeg: [270, 290],
        codes: [3, 61],
      },
    ]);
  });
});

describe('openMeteoTemperatures', () => {
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('asks for every point in one request, by UTC day', async () => {
    const urls: string[] = [];
    const lookup = openMeteoTemperatures(
      'test-agent',
      async (url) => {
        urls.push(String(url));
        return ok([
          { minutely_15: { time: [0], temperature_2m: [1] } },
          { hourly: { time: [0], temperature_2m: [2] } },
        ]);
      },
      () => at(30).getTime(),
    );
    const series = await lookup(
      [
        { lat: 40.123456, lon: -89.1 },
        { lat: 40.2, lon: -89.2 },
      ],
      new Date('2026-10-01T23:50:00Z'),
      new Date('2026-10-02T00:20:00Z'),
    );
    expect(series.map((s) => s.tempsC)).toEqual([[1], [2]]);
    const url = new URL(urls[0]!);
    expect(url.origin).toBe('https://api.open-meteo.com');
    expect(url.searchParams.get('latitude')).toBe('40.1235,40.2000');
    expect(url.searchParams.get('start_date')).toBe('2026-10-01');
    expect(url.searchParams.get('end_date')).toBe('2026-10-02');
  });

  it('uses the historical API for drives the forecast API no longer keeps', async () => {
    let origin = '';
    const lookup = openMeteoTemperatures(
      'test-agent',
      async (url) => {
        origin = new URL(String(url)).origin;
        return ok({ hourly: { time: [0], temperature_2m: [1] } });
      },
      () => at(0).getTime() + 100 * 86400_000,
    );
    await lookup([{ lat: 40, lon: -89 }], at(0), at(20));
    expect(origin).toBe('https://historical-forecast-api.open-meteo.com');
  });

  it('tells rate limits and rejected requests apart from other failures', async () => {
    const failing = (status: number) =>
      openMeteoTemperatures('test-agent', async () => ok({ error: true, reason: 'nope' }, status));
    const args = [[{ lat: 40, lon: -89 }], at(0), at(20)] as const;
    await expect(failing(429)(...args)).rejects.toBeInstanceOf(RateLimitedError);
    await expect(failing(400)(...args)).rejects.toBeInstanceOf(LookupRejectedError);
    await expect(failing(400)(...args)).rejects.toThrow('nope');
    await expect(failing(502)(...args)).rejects.toThrow('HTTP 502');
  });
});
