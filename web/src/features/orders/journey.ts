import type { Delivery, OrderItem, OrderJourneyDto, OrderVehicle } from '@server/api-types';

/*
 * Reading a Rivian order for people. Statuses are Rivian's own strings; the
 * ones seen so far get words, any other is shown tidied up rather than
 * hidden. They trail the car by days, so nothing here claims more than the
 * status says.
 */

export type MilestoneKey = 'ordered' | 'built' | 'prepared' | 'scheduled' | 'delivered';
export type MilestoneState = 'done' | 'current' | 'upcoming';

export interface Milestone {
  key: MilestoneKey;
  label: string;
  state: MilestoneState;
  /** When it happened, or is planned to ("Oct 21, 2026"). */
  date: string | null;
  /** A line under the date: a plan, or what's under way. */
  note: string | null;
}

/** "SOME_STATUS" as "Some status": an unknown status, shown rather than hidden. */
export function humanize(code: string): string {
  const words = code.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const VEHICLE_STATUS: Record<string, { label: string; sentence: string }> = {
  FACTORY_OK: { label: 'Passed factory checks', sentence: 'It has passed its factory checks' },
  FACTORY_GATED: { label: 'Left the factory', sentence: 'It has left the factory' },
  STAGED_FOR_PDI: {
    label: 'Awaiting inspection',
    sentence: 'It’s waiting for its pre-delivery inspection',
  },
  PDI_COMPLETED: { label: 'Inspected', sentence: 'Its pre-delivery inspection is done' },
  VEHICLE_PREPPED: { label: 'Ready for delivery', sentence: 'It’s been prepared for you' },
  DELIVERED: { label: 'Delivered', sentence: 'It’s been delivered' },
};

const PREPARED = new Set(['PDI_COMPLETED', 'VEHICLE_PREPPED', 'DELIVERED']);

export function vehicleStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  if (status.startsWith('IN_TRANSIT')) return 'In transit';
  return VEHICLE_STATUS[status]?.label ?? humanize(status);
}

function vehicleStatusSentence(status: string | null | undefined): string | null {
  if (!status) return null;
  if (status.startsWith('IN_TRANSIT')) return 'It’s on its way';
  return VEHICLE_STATUS[status]?.sentence ?? null;
}

export function deliveryStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return status === 'DELIVERY_ACCEPTED' ? 'Confirmed' : humanize(status);
}

export function carrierLabel(carrier: string | null | undefined): string | null {
  if (!carrier) return null;
  if (carrier === 'RIVIAN') return 'Rivian';
  if (carrier === 'THIRD_PARTY') return 'A carrier for Rivian';
  return humanize(carrier);
}

export function parts(j: OrderJourneyDto) {
  const detail = j.detail.ok ? j.detail.value : null;
  const delivery = j.delivery?.ok ? j.delivery.value : null;
  return { detail, vehicle: detail?.vehicle ?? null, delivery };
}

/** Delivered: in the account, or Rivian says so. */
export function isDelivered(j: OrderJourneyDto): boolean {
  const { detail, vehicle } = parts(j);
  return (
    j.delivered ||
    j.fulfillmentSummaryStatus === 'VEHICLE_DELIVERED' ||
    detail?.fulfillmentSummaryStatus === 'VEHICLE_DELIVERED' ||
    vehicle?.status === 'DELIVERED'
  );
}

/** "R2", "R1S": the model as people say it. */
export function modelName(j: OrderJourneyDto): string {
  const { detail, vehicle } = parts(j);
  if (vehicle?.model) return vehicle.model;
  const title = detail?.items.find((i) => i.type === 'VEHICLE')?.title;
  const fromTitle = title?.match(/\bR\d[A-Z]?\b/)?.[0];
  return fromTitle ?? 'Rivian';
}

/** "2027 Rivian R2". */
export function modelLine(vehicle: OrderVehicle | null, model: string): string {
  const make = vehicle?.make ? titleCase(vehicle.make) : 'Rivian';
  return [vehicle?.modelYear, make, model].filter(Boolean).join(' ');
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** "2026-01-29" as "Jan 29, 2026", the day Rivian wrote, in no time zone. */
export function calendarDate(ymd: string | null | undefined, withYear = true): string | null {
  const m = ymd?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(withYear && { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

/** An ISO instant ("2026-06-16T14:46:39Z") as the local day it fell on. */
export function instantDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return calendarDate(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

interface WallClock {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
}

function wallClockIn(instant: Date, timeZone: string): WallClock | null {
  try {
    const get = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const n = (type: string) => Number(get.find((p) => p.type === type)?.value);
    return { y: n('year'), m: n('month'), d: n('day'), h: n('hour'), min: n('minute') };
  } catch {
    return null;
  }
}

/**
 * Rivian's appointment times are the delivery location's wall clock with no
 * offset ("2027-02-06T10:30:00" in America/Chicago). One with an offset is
 * converted into the zone instead.
 */
function appointmentClock(value: string, timeZone: string | null): WallClock | null {
  const offset = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  if (offset && timeZone) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return wallClockIn(d, timeZone);
  }
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  return { y: +m[1]!, m: +m[2]!, d: +m[3]!, h: +(m[4] ?? 0), min: +(m[5] ?? 0) };
}

const asUtc = (c: WallClock) => new Date(Date.UTC(c.y, c.m - 1, c.d, c.h, c.min));
const dayNumber = (c: WallClock) => Date.UTC(c.y, c.m - 1, c.d) / 86_400_000;

export interface AppointmentView {
  /** "Saturday" */
  weekday: string;
  /** "Sat" */
  weekdayShort: string;
  /** "February 6" */
  date: string;
  /** "Saturday, February 6, 2027" */
  fullDate: string;
  /** "Feb 6, 2027" */
  shortDate: string;
  /** "Feb" */
  month: string;
  /** "6" */
  day: string;
  /** "2027" */
  year: string;
  /** "10:30 – 11:00 AM", or just the start. */
  time: string | null;
  /** "10:30 AM" */
  startTime: string | null;
  /** "CST", or the zone itself where the browser has no short name. */
  zone: string | null;
  /** Days from today in the appointment's zone: 0 today, negative past. */
  daysAway: number;
}

/** The appointment in the delivery location's own time, the day computed there. */
export function appointmentView(
  appointment: Delivery['appointment'],
  now = new Date(),
): AppointmentView | null {
  if (!appointment?.start) return null;
  const tz = appointment.timeZone;
  const start = appointmentClock(appointment.start, tz);
  if (!start) return null;
  const end = appointment.end ? appointmentClock(appointment.end, tz) : null;
  const day = asUtc(start);
  const utcDate = (o: Intl.DateTimeFormatOptions) =>
    day.toLocaleDateString([], { ...o, timeZone: 'UTC' });

  const hasTime = /T\d{2}:\d{2}/.test(appointment.start);
  const timeFmt = new Intl.DateTimeFormat([], {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  const time = !hasTime
    ? null
    : end && dayNumber(end) === dayNumber(start)
      ? timeFmt.formatRange(asUtc(start), asUtc(end))
      : timeFmt.format(asUtc(start));

  let zone: string | null = null;
  if (tz && hasTime) {
    try {
      // The instant is near enough: a short name only changes at a DST switch.
      zone =
        new Intl.DateTimeFormat([], { timeZone: tz, timeZoneName: 'short' })
          .formatToParts(asUtc(start))
          .find((p) => p.type === 'timeZoneName')?.value ?? tz;
    } catch {
      zone = tz;
    }
  }

  const today = (tz && wallClockIn(now, tz)) || wallClockIn(now, 'UTC')!;
  return {
    weekday: utcDate({ weekday: 'long' }),
    weekdayShort: utcDate({ weekday: 'short' }),
    date: utcDate({ month: 'long', day: 'numeric' }),
    fullDate: utcDate({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    shortDate: utcDate({ month: 'short', day: 'numeric', year: 'numeric' }),
    month: utcDate({ month: 'short' }),
    year: String(start.y),
    day: String(start.d),
    time,
    startTime: hasTime ? timeFmt.format(asUtc(start)) : null,
    zone,
    daysAway: Math.round(dayNumber(start) - dayNumber(today)),
  };
}

/** "Today", "Tomorrow", "In 9 days"; null once it's past. */
export function relativeDay(daysAway: number): string | null {
  if (daysAway < 0) return null;
  if (daysAway === 0) return 'Today';
  if (daysAway === 1) return 'Tomorrow';
  return `In ${daysAway} days`;
}

/** "Normal, IL" */
export function placeLine(address: Delivery['address']): string | null {
  if (!address) return null;
  return [address.city, address.state].filter(Boolean).join(', ') || null;
}

/** The five steps from order to delivery, and where this order stands. */
export function milestones(j: OrderJourneyDto, now = new Date()): Milestone[] {
  const { detail, vehicle, delivery } = parts(j);
  const delivered = isDelivered(j);
  const appt = appointmentView(delivery?.appointment ?? null, now);
  const built = vehicle?.actualGeneralAssemblyDate ?? null;
  const planned = vehicle?.plannedBuildDate ?? vehicle?.expectedBuildDate ?? null;
  const prepared = delivered || (vehicle?.status != null && PREPARED.has(vehicle.status));

  // Each step's label as it stands: the event once it's happened ("Built"),
  // the stage while it's under way or ahead ("Build").
  const steps: (Omit<Milestone, 'state' | 'label'> & { label: [string, string] })[] = [
    {
      key: 'ordered',
      label: ['Ordered', 'Order'],
      date: instantDate(detail?.orderDate),
      note: null,
    },
    {
      key: 'built',
      label: ['Built', 'Build'],
      date: calendarDate(built),
      note: !built && planned ? `Planned for ${calendarDate(planned)}` : null,
    },
    {
      key: 'prepared',
      label: ['Inspected', 'Inspection'],
      date: null,
      note: !prepared && built ? vehicleStatusLabel(vehicle?.status) : null,
    },
    {
      key: 'scheduled',
      label: ['Scheduled', 'Scheduling'],
      // Once delivered, the day is the delivery's: said there, not twice.
      date: appt && !delivered ? appt.shortDate : null,
      note: appt && !delivered ? appt.time : null,
    },
    {
      key: 'delivered',
      label: ['Delivered', 'Delivery'],
      date: delivered && appt ? appt.shortDate : null,
      note: null,
    },
  ];
  const done: Record<MilestoneKey, boolean> = {
    ordered: true,
    built: built != null || prepared,
    prepared,
    scheduled: appt != null || delivered,
    delivered,
  };
  let currentGiven = false;
  return steps.map(({ label: [happened, ahead], ...s }) => {
    if (done[s.key]) return { ...s, label: happened, state: 'done' };
    const state: MilestoneState = currentGiven ? 'upcoming' : 'current';
    currentGiven = true;
    return { ...s, label: ahead, state };
  });
}

export interface Headline {
  kicker: string;
  title: string;
  summary: string;
}

/**
 * What the page says first: where the vehicle is, in a sentence or two.
 * Once delivered it's the vehicle's own name ("Shadow"), as everywhere else.
 */
export function headline(
  j: OrderJourneyDto,
  now = new Date(),
  vehicleName?: string | null,
): Headline {
  const { vehicle, delivery } = parts(j);
  const model = modelName(j);
  const appt = appointmentView(delivery?.appointment ?? null, now);
  const place = placeLine(delivery?.address ?? null);
  const at = place ? ` in ${place}` : '';
  const deliveryUnknown = j.delivery != null && !j.delivery.ok;

  if (isDelivered(j)) {
    const came = appt ? `It came home on ${appt.fullDate}${at}.` : 'Welcome home.';
    return {
      kicker: 'Delivered',
      // In the account it has a name of its own; until then it's still the order.
      title: vehicleName || `Your ${model}, delivered`,
      // Rivian can call it delivered before it's in the account, and logged.
      // Once in, say nothing of logging: it may have started long after delivery.
      summary: j.delivered
        ? came
        : `${came} RivianMate starts logging as soon as Rivian adds it to your account.`,
    };
  }

  const status = vehicleStatusSentence(vehicle?.status);
  const built = vehicle?.actualGeneralAssemblyDate;
  const lead = status ?? (built ? `It was built on ${calendarDate(built)}` : null);

  if (appt && appt.daysAway >= 0) {
    const when =
      appt.daysAway === 0
        ? 'today'
        : appt.daysAway === 1
          ? 'tomorrow'
          : appt.daysAway < 7
            ? appt.weekday
            : appt.date;
    // The range's start: "10:30 – 11:00 AM" reads "10:30 AM" alone.
    const time = appt.startTime ? ` at ${appt.startTime}` : '';
    return {
      kicker: 'Delivery scheduled',
      title: `Your ${model} arrives ${when}`,
      summary: `${lead ? `${lead}. ` : ''}Rivian has your delivery set for ${appt.fullDate}${time}${at}.`,
    };
  }
  if (appt) {
    return {
      kicker: 'Almost home',
      title: `Your ${model} is almost home`,
      summary: `Your delivery was set for ${appt.fullDate}${at}. RivianMate starts logging as soon as it appears in your Rivian account.`,
    };
  }
  if (built) {
    return {
      kicker: 'Built',
      title: `Your ${model} is built`,
      // A failed delivery lookup is unknown, never "not scheduled".
      summary: `${lead ?? `It was built on ${calendarDate(built)}`}. ${
        deliveryUnknown
          ? 'Its delivery appointment will show here once Rivian’s delivery service answers.'
          : 'Rivian hasn’t scheduled the delivery yet; it will show here as soon as it’s set.'
      }`,
    };
  }
  const planned = calendarDate(vehicle?.plannedBuildDate ?? vehicle?.expectedBuildDate);
  return {
    kicker: 'On order',
    title: `Your ${model} is on order`,
    summary: planned
      ? `Rivian plans to build it around ${planned}. Each step will show here as it happens.`
      : 'Each step, from the factory to your driveway, will show here as it happens.',
  };
}

/** Option groups worth a line, in the order people read a build sheet. */
const SPEC_GROUPS: { group: string; label: string; suffix?: RegExp }[] = [
  { group: 'PKG', label: 'Trim', suffix: /\s+trim$/i },
  { group: 'MOT', label: 'Drive' },
  { group: 'BAT', label: 'Battery', suffix: /\s+battery( pack)?$/i },
  { group: 'EXP', label: 'Paint', suffix: /\s+paint$/i },
  { group: 'WHL', label: 'Wheels', suffix: /\s+wheels?$/i },
  { group: 'INT', label: 'Interior', suffix: /\s+interior$/i },
  { group: 'ROOF', label: 'Roof' },
  { group: 'ACTBDG', label: 'Package' },
  { group: 'TOW', label: 'Towing' },
  { group: 'CHRG', label: 'Charge port' },
];
/** Groups that say nothing a person needs: they're in the model line or plain. */
const QUIET_GROUPS = new Set(['V_GEN', 'MODEL_YEAR', 'RGN', 'BLD']);

export interface Spec {
  rows: { label: string; value: string }[];
  /** Everything else on the order: other options, and accessories. */
  extras: string[];
  /** "Generation Two", when Rivian says. */
  generation: string | null;
}

export function specification(items: OrderItem[]): Spec {
  const options = items.filter((i) => i.type === 'VEHICLE').flatMap((i) => i.options);
  const rows: Spec['rows'] = [];
  for (const g of SPEC_GROUPS) {
    const o = options.find((x) => x.group === g.group && x.name);
    if (!o?.name) continue;
    const value = g.suffix ? o.name.replace(g.suffix, '') : o.name;
    rows.push({ label: g.label, value: value || o.name });
  }
  const known = new Set(SPEC_GROUPS.map((g) => g.group));
  const extras = [
    ...options
      .filter((o) => o.name && !known.has(o.group ?? '') && !QUIET_GROUPS.has(o.group ?? ''))
      .map((o) => o.name!),
    ...items.filter((i) => i.type !== 'VEHICLE' && i.title).map((i) => i.title!),
  ];
  const generation = options.find((o) => o.group === 'V_GEN')?.name ?? null;
  return { rows, extras, generation };
}
