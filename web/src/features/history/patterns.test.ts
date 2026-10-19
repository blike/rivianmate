import { describe, expect, it } from 'vitest';
import {
  chargeSource,
  commonRoutes,
  drivingRhythm,
  energyBalance,
  energyLedger,
  topDestinations,
  type PatternDrive,
  type PatternSession,
} from './patterns';

const place = (label: string, isHome = false) => ({ label, isHome, locationId: null });
/** Local time on Monday, Oct 12, 2026 plus `day` days. */
const local = (day: number, hour: number) => new Date(2026, 9, 12 + day, hour, 15).toISOString();

const drive = (
  day: number,
  hour: number,
  start: string,
  end: string,
  km = 10,
  kwh: number | null = 3,
): PatternDrive => ({
  startedAt: local(day, hour),
  endedAt: local(day, hour + 1),
  distanceKm: km,
  energyKwh: kwh,
  start: place(start, start === 'Home'),
  end: place(end, end === 'Home'),
});

const from = new Date(2026, 9, 1).getTime();
const to = new Date(2026, 10, 1).getTime();

describe('drivingRhythm', () => {
  it('counts drives by local weekday, Monday first, and hour', () => {
    const r = drivingRhythm(
      [drive(0, 8, 'Home', 'Work'), drive(7, 8, 'Home', 'Work'), drive(6, 17, 'Work', 'Home')],
      from,
      to,
    );
    expect(r.count[0]![8]).toBe(2);
    expect(r.count[6]![17]).toBe(1);
    expect(r.km[0]![8]).toBe(20);
    expect(r.max).toBe(2);
  });

  it('leaves out drives outside the window', () => {
    const r = drivingRhythm([drive(0, 8, 'Home', 'Work')], to, to + 1);
    expect(r.max).toBe(0);
  });
});

describe('topDestinations', () => {
  it('ranks where drives ended by visits', () => {
    const top = topDestinations(
      [
        drive(0, 8, 'Home', 'Work', 12),
        drive(0, 17, 'Work', 'Home', 12),
        drive(1, 8, 'Home', 'Work', 13),
        drive(1, 12, 'Work', 'Cafe', 2),
      ],
      from,
      to,
    );
    expect(top.map((p) => [p.label, p.visits])).toEqual([
      ['Work', 2],
      ['Cafe', 1],
      ['Home', 1],
    ]);
    expect(top[0]!.km).toBe(25);
    expect(top[2]!.isHome).toBe(true);
  });

  it('skips drives still under way', () => {
    const live = { ...drive(0, 8, 'Home', 'Work'), endedAt: null };
    expect(topDestinations([live], from, to)).toEqual([]);
  });
});

describe('commonRoutes', () => {
  it('pairs both directions and keeps routes taken more than once', () => {
    const routes = commonRoutes(
      [
        drive(0, 8, 'Home', 'Work', 12, 4),
        drive(0, 17, 'Work', 'Home', 14, null),
        drive(1, 12, 'Home', 'Cafe', 2),
      ],
      from,
      to,
    );
    expect(routes).toEqual([
      { from: 'Home', to: 'Work', trips: 2, avgKm: 13, energyKwh: 4, energyKm: 12 },
    ]);
  });
});

describe('chargeSource', () => {
  const s = (over: Partial<PatternSession>): PatternSession => ({
    startedAt: local(0, 1),
    energyKwh: 10,
    cost: null,
    currency: null,
    isHome: false,
    ...over,
  });
  it('sorts sessions into home, public and elsewhere', () => {
    expect(chargeSource(s({ isHome: true }))).toBe('home');
    expect(chargeSource(s({ location: { name: 'Cabin', isHome: true } }))).toBe('home');
    expect(chargeSource(s({ isPublic: true }))).toBe('public');
    expect(chargeSource(s({ isPublic: false }))).toBe('other');
    expect(chargeSource(s({ location: { name: 'Work', isHome: false } }))).toBe('other');
    expect(chargeSource(s({}))).toBe('public');
  });
});

describe('energyLedger', () => {
  it('splits energy and cost by where it was charged, against what drives used', () => {
    const ledger = energyLedger(
      [drive(0, 8, 'Home', 'Work', 20, 6), drive(0, 17, 'Work', 'Home', 20, null)],
      [
        {
          startedAt: local(0, 1),
          energyKwh: 30,
          cost: null,
          estimatedCost: '4.5',
          currency: 'USD',
          isHome: true,
        },
        {
          startedAt: local(1, 12),
          energyKwh: null,
          estimatedEnergyKwh: 20,
          cost: '9',
          currency: 'USD',
          isHome: false,
          isPublic: true,
        },
      ],
      from,
      to,
      Date.parse(local(-20, 8)),
    );
    expect(ledger.charged).toEqual({ home: 30, public: 20, other: 0 });
    expect(ledger.chargedKwh).toBe(50);
    expect(ledger.cost).toEqual({ home: 4.5, public: 9, other: null });
    expect(ledger.totalCost).toBe(13.5);
    expect(ledger.usedKwh).toBe(6);
    expect(ledger.usedKm).toBe(20);
    expect(ledger.since).toBeNull();
  });

  it('leaves out charging from before the drives begin', () => {
    const session = (day: number) => ({
      startedAt: local(day, 1),
      energyKwh: 10,
      cost: null,
      currency: 'USD',
      isHome: true,
    });
    const ledger = energyLedger(
      [drive(2, 8, 'Home', 'Work')],
      [session(-5), session(1), session(3)],
      from,
      to,
      Date.parse(local(2, 8)),
    );
    expect(ledger.since).toBe(Date.parse(local(2, 8)));
    expect(ledger.chargedKwh).toBe(10);
  });

  it('keeps the whole period when drives were recorded before it began', () => {
    // No drive falls early in the window, but drive history reaches back past it.
    const session = {
      startedAt: local(1, 1),
      energyKwh: 10,
      cost: null,
      currency: 'USD',
      isHome: true,
    };
    const ledger = energyLedger(
      [drive(5, 8, 'Home', 'Work')],
      [session],
      Date.parse(local(1, 0)),
      to,
      Date.parse(local(-30, 8)),
    );
    expect(ledger.since).toBeNull();
    expect(ledger.chargedKwh).toBe(10);
  });

  it('keeps the whole period when there are no drives at all', () => {
    expect(energyLedger([], [], from, to, null).since).toBeNull();
  });
});

describe('energyBalance', () => {
  const ledger = () =>
    energyLedger(
      [drive(1, 8, 'Home', 'Work', 100, 30)],
      [
        {
          startedAt: local(0, 1),
          energyKwh: 50,
          thermalKwh: 2,
          cost: null,
          currency: 'USD',
          isHome: true,
        },
      ],
      from,
      to,
      null,
    );
  const battery = {
    capacityKwh: 100,
    startLevel: 60,
    endLevel: 70,
    parkedLossPct: 5,
    parkedHours: 48,
  };

  it('splits what was charged into driving, parked, losses, the battery, and the rest', () => {
    // 50 charged = 30 driving + 5 parked + 2 losses + 10 into the battery + 3 unaccounted.
    expect(energyBalance(ledger(), battery)).toEqual({
      drivingKwh: 30,
      parkedKwh: 5,
      parkedHours: 48,
      thermalKwh: 2,
      batteryChangeKwh: 10,
      unaccountedKwh: 3,
    });
  });

  it('counts a battery that ran down as energy the period used', () => {
    const b = energyBalance(ledger(), { ...battery, startLevel: 70, endLevel: 60 })!;
    expect(b.batteryChangeKwh).toBe(-10);
    expect(b.unaccountedKwh).toBe(23);
  });

  it('needs the levels and capacity', () => {
    expect(energyBalance(ledger(), undefined)).toBeNull();
    expect(energyBalance(ledger(), { ...battery, capacityKwh: null })).toBeNull();
    expect(energyBalance(ledger(), { ...battery, endLevel: null })).toBeNull();
  });
});
