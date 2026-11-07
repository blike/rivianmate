import { describe, expect, it } from 'vitest';
import { location } from './state';

const gnss = (timeStamp: string, latitude = 40.5) => ({ latitude, longitude: -89, timeStamp });
const nav = (timeStamp: string, latitude = 40.6) => ({
  latitude,
  longitude: -89,
  timeStamp,
  speedMps: 12.5,
  bearing: 271.5,
});
const v = (timeStamp: string, value: number) => ({ timeStamp, value });

describe('location', () => {
  it("shows the vehicle's own fix, with its speed and heading, when not navigating", () => {
    expect(
      location({
        gnssLocation: gnss('2026-10-13T12:00:00Z'),
        gnssSpeed: v('2026-10-13T12:00:00Z', 10),
        gnssBearing: v('2026-10-13T12:00:00Z', 90),
      }),
    ).toEqual({ lat: 40.5, lon: -89, ts: '2026-10-13T12:00:00Z', bearing: 90, speedMps: 10 });
  });

  it('shows the navigation fix, with its own speed and heading, while it runs', () => {
    // An R2: its own fix a minute old, navigation's from a moment ago.
    expect(
      location({
        gnssLocation: gnss('2026-10-13T11:59:10Z'),
        gnssBearing: v('2026-10-13T11:59:10Z', 90),
        navLocation: nav('2026-10-13T12:00:05Z'),
      }),
    ).toEqual({ lat: 40.6, lon: -89, ts: '2026-10-13T12:00:05Z', bearing: 271.5, speedMps: 12.5 });
  });

  it("goes back to the vehicle's own fix once it is more than 15 s newer, and not sooner", () => {
    const at = (ts: string) =>
      location({ gnssLocation: gnss(ts), navLocation: nav('2026-10-13T12:00:00Z') })?.lat;
    expect(at('2026-10-13T12:00:15Z')).toBe(40.6);
    expect(at('2026-10-13T12:00:15.001Z')).toBe(40.5);
  });

  it('shows a navigation fix when there is no fix of its own', () => {
    expect(location({ navLocation: nav('2026-10-13T12:00:00Z') })?.lat).toBe(40.6);
  });

  it('passes over a navigation fix that is no position', () => {
    expect(
      location({
        gnssLocation: gnss('2026-10-13T12:00:00Z'),
        navLocation: { ...nav('2026-10-13T12:00:05Z'), latitude: 0, longitude: 0 },
      }),
    ).toMatchObject({ lat: 40.5 });
  });
});
