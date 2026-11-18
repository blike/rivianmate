import type { OrderDetail, OrderJourneyDto } from '@server/api-types';
import { describe, expect, it } from 'vitest';
import {
  appointmentView,
  calendarDate,
  headline,
  humanize,
  instantDate,
  milestones,
  relativeDay,
  specification,
  vehicleStatusLabel,
} from './journey';

const detail = (vehicle: Partial<NonNullable<OrderDetail['vehicle']>> | null): OrderDetail => ({
  id: 'o1',
  type: 'VEHICLE',
  state: 'ORDERED',
  orderDate: '2026-04-02T15:20:11.000Z',
  configurationStatus: 'SOFT_LOCKED',
  fulfillmentSummaryStatus: 'READY_FOR_FULFILLMENT',
  vehicle: vehicle && {
    vehicleId: 'v1',
    vin: '7PDSGABA0TN000002',
    modelYear: '2027',
    model: 'R2',
    make: 'RIVIAN',
    plannedBuildDate: '2026-10-19',
    expectedBuildDate: '2026-10-12',
    expectedGeneralAssemblyStartDate: '2026-10-19',
    actualGeneralAssemblyDate: null,
    status: null,
    ...vehicle,
  },
  items: [],
  reservedDate: null,
  orderedDate: null,
  estimatedDelivery: null,
});

const appointment = (start: string, end: string | null = null) => ({
  id: 'a1',
  start,
  end,
  timeZone: 'America/Chicago',
});

function journey(over: Partial<OrderJourneyDto> & { detailValue?: OrderDetail | null } = {}) {
  const { detailValue = detail({}), ...rest } = over;
  return {
    orderId: 'o1',
    delivered: false,
    vehicleId: 'v1',
    state: 'ORDERED',
    fulfillmentSummaryStatus: 'READY_FOR_FULFILLMENT',
    detail: { ok: true, value: detailValue },
    delivery: { ok: true, value: null },
    renders: [],
    ...rest,
  } satisfies OrderJourneyDto;
}

const withAppointment = (start: string, end: string | null = null) => ({
  ok: true as const,
  value: {
    status: 'DELIVERY_ACCEPTED',
    carrier: 'RIVIAN',
    vin: null,
    appointment: appointment(start, end),
    address: { line1: '1 Way', line2: null, city: 'Normal', state: 'IL', zipcode: '61761' },
  },
});

// 9:00 on Nov 10, 2026 in Chicago.
const NOW = new Date('2026-11-10T15:00:00Z');

describe('appointmentView', () => {
  it('reads the wall clock in the appointment’s zone, the weekday computed there', () => {
    const v = appointmentView(appointment('2026-11-19T10:30:00', '2026-11-19T11:00:00'), NOW)!;
    expect(v.weekday).toBe('Thursday');
    expect(v.date).toBe('November 19');
    expect(v.month).toBe('Nov');
    expect(v.year).toBe('2026');
    expect(v.day).toBe('19');
    expect(v.time).toMatch(/^10:30\s*–\s*11:00\s*AM$/);
    expect(v.startTime).toMatch(/^10:30\s*AM$/);
    expect(v.zone).toBe('CST');
    expect(v.daysAway).toBe(9);
  });

  it('converts a time that carries an offset into the zone, not relabelling it', () => {
    // 04:30 UTC is still the evening before in Chicago.
    const v = appointmentView(appointment('2026-11-20T04:30:00Z'), NOW)!;
    expect(v.weekday).toBe('Thursday');
    expect(v.startTime).toMatch(/^10:30\s*PM$/);
  });

  it('counts days by the zone’s calendar, so late evening is still today', () => {
    const lateEvening = new Date('2026-11-11T05:30:00Z'); // 11:30 PM Nov 10 in Chicago
    expect(appointmentView(appointment('2026-11-11T09:00:00'), lateEvening)!.daysAway).toBe(1);
  });

  it('is null without a start', () => {
    expect(appointmentView(null)).toBeNull();
    expect(appointmentView({ id: null, start: null, end: null, timeZone: null })).toBeNull();
  });
});

describe('milestones', () => {
  const states = (j: OrderJourneyDto) =>
    Object.fromEntries(milestones(j, NOW).map((m) => [m.key, m.state]));
  const labels = (j: OrderJourneyDto) => milestones(j, NOW).map((m) => m.label);
  const step = (j: OrderJourneyDto, key: string) => milestones(j, NOW).find((m) => m.key === key)!;

  it('stands at the build with a plan, before the car is built', () => {
    const j = journey({ detailValue: detail({ vin: null }) });
    expect(states(j)).toEqual({
      ordered: 'done',
      vin: 'current',
      built: 'upcoming',
      shipped: 'upcoming',
      inspected: 'upcoming',
      prepped: 'upcoming',
      delivered: 'upcoming',
    });
    expect(step(j, 'built').note).toBe('Planned for Oct 19, 2026');
    expect(labels(j)).toEqual([
      'Ordered',
      'VIN',
      'Build',
      'Shipping',
      'Inspection',
      'Delivery prep',
      'Delivery day',
    ]);
    expect(step(j, 'delivered').note).toBe('Not booked yet');
  });

  it('shows the reservation as its own step, dated, before the order', () => {
    const d = {
      ...detail({}),
      reservedDate: '2025-03-07T18:00:00Z',
      orderedDate: '2026-04-02T15:20:11.000Z',
    };
    const m = milestones(journey({ detailValue: d }), NOW);
    expect(m.slice(0, 2).map((s) => [s.label, s.date])).toEqual([
      ['Reserved', instantDate('2025-03-07T18:00:00Z')],
      ['Ordered', instantDate('2026-04-02T15:20:11.000Z')],
    ]);
  });

  it('stands at the order while it’s only a reservation', () => {
    const d = { ...detail(null), reservedDate: '2025-09-02T15:20:11.220Z' };
    const j = journey({ detailValue: d });
    expect(states(j)).toMatchObject({ reserved: 'done', ordered: 'current', vin: 'upcoming' });
    expect(step(j, 'ordered').date).toBeNull();
  });

  it('dates the order in the delivery’s zone, the buyer’s day', () => {
    // 01:30 UTC on Apr 3 is the evening of Apr 2 in Chicago.
    const d = { ...detail({}), orderedDate: '2026-04-03T01:30:00.000Z' };
    const j = journey({ detailValue: d, delivery: withAppointment('2026-11-19T10:30:00') });
    expect(step(j, 'ordered').date).toBe('Apr 2, 2026');
  });

  it('is on the way to the delivery city once it has left the factory', () => {
    const j = journey({
      detailValue: detail({ actualGeneralAssemblyDate: '2026-10-21', status: 'FACTORY_GATED' }),
      delivery: withAppointment('2026-11-19T10:30:00'),
    });
    expect(step(j, 'shipped')).toMatchObject({ label: 'On the way to Normal', state: 'current' });
    expect(step(j, 'built').state).toBe('done');
  });

  it('isn’t on the way while built and still at the factory', () => {
    const j = journey({
      detailValue: detail({ actualGeneralAssemblyDate: '2026-10-21', status: 'FACTORY_OK' }),
    });
    expect(step(j, 'shipped')).toMatchObject({ label: 'Shipping', state: 'current' });
  });

  it('takes a later status as every step before it done, skipped or not', () => {
    const j = journey({
      detailValue: detail({ status: 'STAGED_FOR_PDI' }),
      delivery: withAppointment('2026-11-19T10:30:00'),
    });
    expect(states(j)).toMatchObject({
      vin: 'done',
      built: 'done',
      shipped: 'done',
      inspected: 'current',
      prepped: 'upcoming',
    });
    expect(step(j, 'shipped').label).toBe('Arrived in Normal');
    expect(step(j, 'inspected').note).toBe('Waiting for inspection');
  });

  it('dates the delivery day ahead of it, with the countdown', () => {
    const j = journey({
      detailValue: detail({ status: 'VEHICLE_PREPPED' }),
      delivery: withAppointment('2026-11-19T10:30:00', '2026-11-19T11:00:00'),
    });
    const day = step(j, 'delivered');
    expect(day).toMatchObject({ label: 'Delivery day', state: 'current' });
    expect(day.date).toBe('Nov 19, 2026');
    expect(day.note).toMatch(/^Thursday · In 9 days · 10:30\s*–\s*11:00\s*AM$/);
  });

  it('never says not booked when the delivery lookup failed', () => {
    const j = journey({ delivery: { ok: false, error: 'INTERNAL_SERVER_ERROR' } });
    expect(step(j, 'delivered').note).toBeNull();
  });

  it('is all done once delivered, dated by the delivery', () => {
    const j = journey({
      delivered: true,
      detailValue: detail({ actualGeneralAssemblyDate: '2026-01-29', status: 'DELIVERED' }),
      delivery: withAppointment('2026-06-20T09:30:00'),
    });
    const m = milestones(j, NOW);
    expect(m.every((s) => s.state === 'done')).toBe(true);
    expect(m.map((s) => s.label)).toEqual([
      'Ordered',
      'VIN assigned',
      'Built',
      'Arrived in Normal',
      'Inspected',
      'Prepped for delivery',
      'Delivered',
    ]);
    expect(step(j, 'delivered')).toMatchObject({ date: 'Jun 20, 2026', note: null });
  });
});

describe('headline', () => {
  it('names the day when it’s within a week', () => {
    const j = journey({
      detailValue: detail({ actualGeneralAssemblyDate: '2026-10-21', status: 'VEHICLE_PREPPED' }),
      delivery: withAppointment('2026-11-14T10:30:00'),
    });
    const h = headline(j, NOW);
    expect(h.title).toBe('Your R2 arrives Saturday');
    expect(h.summary).toContain('It’s been prepared for you.');
    expect(h.summary).toContain('in Normal, IL');
  });

  it('says tomorrow and today', () => {
    expect(headline(journey({ delivery: withAppointment('2026-11-11T09:00:00') }), NOW).title).toBe(
      'Your R2 arrives tomorrow',
    );
    expect(headline(journey({ delivery: withAppointment('2026-11-10T16:00:00') }), NOW).title).toBe(
      'Your R2 arrives today',
    );
  });

  it('says built, without an appointment', () => {
    const j = journey({ detailValue: detail({ actualGeneralAssemblyDate: '2026-10-21' }) });
    expect(headline(j, NOW).title).toBe('Your R2 is built');
    expect(headline(j, NOW).summary).toContain('hasn’t scheduled the delivery yet');
  });

  it('never says unscheduled when the delivery lookup failed', () => {
    const j = journey({
      detailValue: detail({ actualGeneralAssemblyDate: '2026-10-21', status: 'VEHICLE_PREPPED' }),
      delivery: { ok: false, error: 'INTERNAL_SERVER_ERROR: User is unauthenticated' },
    });
    expect(headline(j, NOW).summary).not.toContain('hasn’t scheduled');
    expect(headline(j, NOW).summary).toContain('once Rivian’s delivery service answers');
  });

  it('titles a delivered vehicle by its name, or as delivered before it has one', () => {
    const home = journey({ delivered: true });
    expect(headline(home, NOW, 'Shadow').title).toBe('Shadow');
    const shipped = journey({ fulfillmentSummaryStatus: 'VEHICLE_DELIVERED' });
    expect(headline(shipped, NOW).title).toBe('Your R2, delivered');
  });

  it('only claims logging once the vehicle is in the account', () => {
    const shipped = journey({ fulfillmentSummaryStatus: 'VEHICLE_DELIVERED' });
    expect(headline(shipped, NOW).summary).toContain('starts logging as soon as');
    const home = journey({ delivered: true });
    expect(headline(home, NOW).summary).not.toContain('logging');
  });

  it('falls back to the item title for the model before a vehicle is assigned', () => {
    const d = { ...detail(null), items: [{ type: 'VEHICLE', title: 'Rivian R2', options: [] }] };
    expect(headline(journey({ detailValue: d }), NOW).title).toBe('Your R2 is on order');
  });

  it('says reserved for a reservation, not on order', () => {
    const d = {
      ...detail(null),
      reservedDate: '2025-09-02T15:20:11.220Z',
      items: [{ type: 'VEHICLE', title: 'Rivian R2', options: [] }],
    };
    const h = headline(journey({ detailValue: d }), NOW);
    expect(h.kicker).toBe('Reserved');
    expect(h.title).toBe('Your R2 is reserved');
  });
});

describe('specification', () => {
  it('labels the build sheet, tidies redundant words, and keeps the rest as extras', () => {
    const spec = specification([
      {
        type: 'VEHICLE',
        title: 'Rivian R1S SUV',
        options: [
          { group: 'V_GEN', id: 'GEN-2', name: 'Generation Two' },
          { group: 'MODEL_YEAR', id: '2026', name: '2026' },
          { group: 'PKG', id: 'PKG-ADV', name: 'Adventure trim' },
          { group: 'EXP', id: 'EXP-ELG', name: 'El Cap Granite paint' },
          { group: 'WHL', id: 'WHL-2SS', name: '22" Sport Bright wheels' },
          { group: 'BAT', id: 'BAT-B01', name: 'Large battery' },
          { group: 'UTL', id: 'UTL-S01', name: 'Air Compressor' },
        ],
      },
      { type: 'ACCESSORIES', title: 'J1772 AC Adapter', options: [] },
    ]);
    expect(spec.rows).toEqual([
      { label: 'Trim', value: 'Adventure' },
      { label: 'Battery', value: 'Large' },
      { label: 'Paint', value: 'El Cap Granite' },
      { label: 'Wheels', value: '22" Sport Bright' },
    ]);
    expect(spec.extras).toEqual(['Air Compressor', 'J1772 AC Adapter']);
    expect(spec.generation).toBe('Generation Two');
  });
});

describe('wording', () => {
  it('names known statuses and tidies unknown ones', () => {
    expect(vehicleStatusLabel('STAGED_FOR_PDI')).toBe('Awaiting inspection');
    expect(vehicleStatusLabel('IN_TRANSIT_TO_HUB')).toBe('In transit');
    expect(vehicleStatusLabel('SOMETHING_NEW')).toBe('Something new');
    expect(humanize('READY_FOR_FULFILLMENT')).toBe('Ready for fulfillment');
  });

  it('reads Rivian’s calendar dates without shifting the day', () => {
    expect(calendarDate('2026-01-29')).toBe('Jan 29, 2026');
    expect(calendarDate('2026-01-29', false)).toBe('Jan 29');
    expect(calendarDate(null)).toBeNull();
  });

  it('counts down in words', () => {
    expect(relativeDay(0)).toBe('Today');
    expect(relativeDay(1)).toBe('Tomorrow');
    expect(relativeDay(9)).toBe('In 9 days');
    expect(relativeDay(-1)).toBeNull();
  });
});
