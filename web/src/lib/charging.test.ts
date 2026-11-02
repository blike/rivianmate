import { describe, expect, it } from 'vitest';
import {
  chargeOutlook,
  chargerLabel,
  sessionCity,
  lastChargedTo,
  chargingSecondsNow,
  rateLabel,
  sessionCost,
  sessionTotals,
  socRange,
} from './charging';
import { fmtSeconds } from './state';

describe('chargingSecondsNow', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');

  it('adds a running stretch to finished ones', () => {
    expect(
      chargingSecondsNow({ chargingSeconds: 600, chargingSince: '2026-10-01T11:30:00Z' }, now),
    ).toBe(600 + 1800);
    expect(chargingSecondsNow({ chargingSeconds: 18779, chargingSince: null }, now)).toBe(18779);
  });

  it("is unknown for sessions RivianMate didn't watch", () => {
    expect(chargingSecondsNow({ chargingSeconds: null, chargingSince: null }, now)).toBeNull();
  });
});

describe('socRange', () => {
  it('shows start → end, marking a missing side', () => {
    expect(socRange(39.7, 70)).toBe('39.7% → 70.0%');
    expect(socRange(39.7, null)).toBe('39.7% → ?');
    expect(socRange(null, null)).toBe('—');
  });
});

describe('fmtSeconds', () => {
  it('formats minutes and hours', () => {
    expect(fmtSeconds(45 * 60)).toBe('45m');
    expect(fmtSeconds(18779)).toBe('5h 13m');
  });
});

describe('chargeOutlook', () => {
  // A real charge: a schedule ending at 12:59 UTC stopped it near 90%, short of a 95% limit.
  const base = { limit: 95, powerKw: 7.4, capacityKwh: 111.5 };

  it('flags a session that ends before the limit, with the SoC it reaches', () => {
    const o = chargeOutlook({ ...base, soc: 84.6, minutesLeft: 56 });
    expect(o.kind).toBe('session');
    expect(o.minutes).toBe(56);
    expect(o.endSoc).toBeCloseTo(90.8, 1);
  });

  it('is time to limit when the session gets there', () => {
    expect(chargeOutlook({ ...base, soc: 90, minutesLeft: 60 })).toMatchObject({
      kind: 'limit',
      minutes: 60,
      endSoc: 95,
    });
  });

  it('estimates time to limit when Rivian gives no time', () => {
    const o = chargeOutlook({ ...base, soc: 85, minutesLeft: null });
    expect(o.kind).toBe('limit');
    expect(o.minutes).toBeCloseTo(10 / (((7.4 / 111.5) * 100) / 60), 5);
  });

  it("trusts Rivian's time when power or pack size is unknown", () => {
    expect(chargeOutlook({ ...base, powerKw: null, soc: 50, minutesLeft: 30 })).toMatchObject({
      kind: 'limit',
      minutes: 30,
    });
  });
});

describe('sessionCost', () => {
  it('prefers the recorded cost over the estimate', () => {
    expect(sessionCost({ cost: '4.25', estimatedCost: '3.00' })).toEqual({
      amount: 4.25,
      estimated: false,
    });
    expect(sessionCost({ cost: null, estimatedCost: '3.00' })).toEqual({
      amount: 3,
      estimated: true,
    });
    expect(sessionCost({ cost: null, estimatedCost: null })).toBeNull();
  });
});

describe('sessionTotals', () => {
  it('adds energy and any costs', () => {
    expect(
      sessionTotals([
        { energyKwh: 30, cost: '4.00', estimatedCost: null },
        { energyKwh: 10, cost: null, estimatedCost: '1.30' },
        { energyKwh: null, cost: null, estimatedCost: null },
      ]),
    ).toEqual({ energyKwh: 40, cost: 5.3, estimated: true });
    expect(sessionTotals([{ energyKwh: 5, cost: null, estimatedCost: null }]).cost).toBeNull();
  });
});

describe('rateLabel', () => {
  it('reads a rate, a free one, or none', () => {
    expect(rateLabel(0.131, 'USD')).toBe('$0.131/kWh');
    expect(rateLabel(0.15, 'EUR')).toBe('EUR 0.15/kWh');
    expect(rateLabel(0, 'USD')).toBe('Free');
    expect(rateLabel(null, 'USD')).toBe('No rate');
  });
});

describe('chargerLabel', () => {
  const base = { chargerType: null, isHome: false, vendor: null, chargerId: null, location: null };

  it("names Rivian's chargers Rivian, however they were recorded", () => {
    expect(chargerLabel({ ...base, chargerType: 'rivian_charger' })).toBe('Rivian');
    expect(chargerLabel({ ...base, vendor: 'RIVIAN' })).toBe('Rivian');
    expect(chargerLabel({ ...base, vendor: 'Rivian Adventure Network' })).toBe('Rivian');
  });

  it('names home and other networks', () => {
    expect(chargerLabel({ ...base, isHome: true })).toBe('Home');
    expect(chargerLabel({ ...base, vendor: 'ELECTRIFY AMERICA' })).toBe('Electrify America');
  });

  it("names a saved location's sessions after it, over the network", () => {
    const work = { id: 2, name: 'Work', isHome: false };
    expect(chargerLabel({ ...base, vendor: 'CHARGEPOINT', location: work })).toBe('Work');
    expect(chargerLabel({ ...base, chargerType: 'rivian_charger', location: work })).toBe('Work');
  });
});

describe('chargerLabel without a charger', () => {
  const base = { chargerType: null, isHome: false, vendor: null, chargerId: null, location: null };

  it('names an imported charge by its city', () => {
    expect(chargerLabel({ ...base, city: 'Austin, TX' })).toBe('Austin, TX');
  });

  it('keeps the charger when there is one', () => {
    expect(chargerLabel({ ...base, vendor: 'CHARGEPOINT', city: 'Austin, TX' })).toBe(
      'Chargepoint',
    );
    expect(chargerLabel({ ...base, chargerType: 'other', city: 'Austin, TX' })).toBe('Other');
  });
});

describe('sessionCity', () => {
  const base = { chargerType: null, isHome: false, vendor: null, chargerId: null, location: null };

  it('sits beside a network, but not a label that already is the city', () => {
    expect(sessionCity({ ...base, vendor: 'CHARGEPOINT', city: 'Austin' })).toBe('Austin');
    expect(sessionCity({ ...base, city: 'Austin, TX' })).toBeNull();
  });

  it('stays out of home and saved places', () => {
    expect(sessionCity({ ...base, isHome: true, city: 'Austin' })).toBeNull();
  });
});

describe('lastChargedTo', () => {
  it('is the level the newest finished charge reached', () => {
    expect(
      lastChargedTo([
        { endedAt: null, endSoc: 60 },
        { endedAt: '2026-10-10T08:00:00Z', endSoc: null },
        { endedAt: '2026-10-09T08:00:00Z', endSoc: 85 },
        { endedAt: '2026-10-08T08:00:00Z', endSoc: 90 },
      ]),
    ).toBe(85);
    expect(lastChargedTo([])).toBeNull();
    expect(lastChargedTo(undefined)).toBeNull();
  });
});
