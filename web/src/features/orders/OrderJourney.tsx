import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { OrderJourneyDto } from '@server/api-types';
import { CalendarPage } from '../../components/CalendarPage';
import { Panel } from '../../components/Panel';
import {
  type AppointmentView,
  type Milestone,
  appointmentView,
  calendarDate,
  carrierLabel,
  deliveryStatusLabel,
  headline,
  isDelivered,
  milestones,
  modelLine,
  modelName,
  parts,
  placeLine,
  relativeDay,
  specification,
  vehicleStatusLabel,
} from './journey';

/**
 * A vehicle order from the order to the delivery: the vehicle in its own
 * paint, where it stands, the appointment, the build and what was ordered.
 * The same page before delivery and after, as a keepsake.
 */
export function OrderJourney(props: {
  journey: OrderJourneyDto;
  checkedAt?: string | null;
  refreshMinutes?: number;
  vehicleName?: string | null;
}) {
  const now = useNow();
  const j = props.journey;
  const { detail, vehicle, delivery } = parts(j);
  const delivered = isDelivered(j);
  const model = modelName(j);
  const head = headline(j, now, props.vehicleName);
  const appt = appointmentView(delivery?.appointment ?? null, now);
  const steps = milestones(j, now);
  const spec = specification(detail?.items ?? []);
  const paint = spec.rows.find((r) => r.label === 'Paint')?.value;

  return (
    <article className="relative">
      <section className="grid items-center gap-x-10 gap-y-2 pt-2 pb-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:pt-6 lg:pb-10">
        <div className="journey-rise min-w-0" style={rise(60)}>
          <div className="mb-4 flex flex-wrap items-center gap-2.5">
            {/* Once delivered, being here says so: no chip. */}
            {!delivered && <StatusChip>{head.kicker}</StatusChip>}
            <span
              className={
                delivered ? 'text-sm text-(--text-secondary)' : 'text-xs text-(--text-muted)'
              }
            >
              {modelLine(vehicle, model)}
              {paint && ` · ${paint}`}
            </span>
          </div>
          <h1 className="text-[2.5rem] leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-[3.25rem] xl:text-[3.75rem]">
            {head.title}
          </h1>
          <p className="mt-5 max-w-xl text-[1.0625rem] leading-relaxed text-pretty text-(--text-secondary)">
            {head.summary}
          </p>
          {!delivered && appt && appt.daysAway >= 0 && <Countdown appt={appt} />}
        </div>
        <Stage journey={j} model={model} />
      </section>

      <div className="journey-rise" style={rise(220)}>
        <Milestones steps={steps} />
      </div>

      <div className="journey-rise mt-4 grid gap-4 lg:grid-cols-2" style={rise(320)}>
        <DeliveryCard journey={j} appt={appt} delivered={delivered} />
        <BuildCard journey={j} generation={spec.generation} model={model} />
      </div>

      {(spec.rows.length > 0 || spec.extras.length > 0) && (
        <div className="journey-rise mt-4" style={rise(420)}>
          <Panel title="Specification">
            {spec.rows.length > 0 && (
              <dl className="mt-1 grid grid-cols-2 gap-x-6 sm:grid-cols-3 xl:grid-cols-4">
                {spec.rows.map((r) => (
                  <div key={r.label} className="border-t border-(--hairline) py-3.5">
                    <dt className="eyebrow">{r.label}</dt>
                    <dd className="mt-1.5 text-[0.9375rem] leading-snug font-medium">{r.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {spec.extras.length > 0 && (
              <div className="mt-3 border-t border-(--hairline) pt-4">
                <div className="eyebrow mb-2.5">Also on the order</div>
                <ul className="flex flex-wrap gap-2">
                  {spec.extras.map((e) => (
                    <li
                      key={e}
                      className="rounded-full border border-(--hairline) bg-(--surface-2) px-3 py-1 text-[0.8125rem] text-(--text-secondary)"
                    >
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
        </div>
      )}

      <Footnote
        delivered={delivered}
        orderId={j.orderId}
        checkedAt={props.checkedAt ?? null}
        refreshMinutes={props.refreshMinutes ?? 15}
        now={now}
      />
    </article>
  );
}

const rise = (ms: number) => ({ '--rise-delay': `${ms}ms` }) as CSSProperties;

/** Re-renders every minute, so "today" and "in 9 days" stay true. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function StatusChip(props: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_9%,transparent)] px-2.5 py-1 text-xs font-medium text-(--accent)">
      <span
        aria-hidden
        className="chip-dot--pulse h-1.5 w-1.5 rounded-full bg-(--accent) text-(--accent)"
      />
      {props.children}
    </span>
  );
}

function Countdown(props: { appt: AppointmentView }) {
  const { appt } = props;
  const days = appt.daysAway;
  return (
    <div className="mt-8 flex items-end gap-5">
      <div className="flex items-baseline gap-2">
        <span className="readout text-[3.5rem] font-light text-(--text-primary)">
          {days === 0 ? 'Today' : days}
        </span>
        {days > 0 && (
          <span className="text-sm text-(--text-secondary)">
            {days === 1 ? 'day' : 'days'} to go
          </span>
        )}
      </div>
      <span aria-hidden className="mb-2 h-8 w-px bg-(--hairline)" />
      <div className="mb-1 text-sm leading-snug">
        <div className="font-medium">{appt.weekday}</div>
        <div className="text-(--text-muted)">
          {appt.date}
          {appt.startTime && ` · ${appt.startTime}`}
        </div>
      </div>
    </div>
  );
}

function Stage(props: { journey: OrderJourneyDto; model: string }) {
  const { journey } = props;
  const view = journey.renders.includes('three-quarter')
    ? 'three-quarter'
    : journey.renders.includes('overhead')
      ? 'overhead'
      : null;
  const [failed, setFailed] = useState(false);
  const src = view ? `/api/orders/${encodeURIComponent(journey.orderId)}/render/${view}` : null;
  return (
    <div className="journey-stage order-first mx-auto w-full max-w-176 lg:order-last">
      <div className="relative aspect-16/10">
        {src && !failed ? (
          <img
            src={src}
            alt={`Your ${props.model}`}
            onError={() => setFailed(true)}
            className="journey-render absolute inset-0 h-full w-full object-contain drop-shadow-[0_24px_32px_rgb(0_0_0/0.55)]"
          />
        ) : (
          // No render yet: the model's name, set large and quiet in its place.
          <div className="journey-render absolute inset-0 grid place-items-center">
            <span
              aria-hidden
              className="text-[clamp(6rem,22vw,13rem)] leading-none font-extralight tracking-[-0.06em] text-transparent [-webkit-text-stroke:1px_rgb(255_255_240/0.22)]"
            >
              {props.model}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Milestones(props: { steps: Milestone[] }) {
  const { steps } = props;
  return (
    <section className="card px-5 py-6 sm:px-7" aria-label="Progress">
      <ol className="grid gap-0 sm:grid-cols-5">
        {steps.map((s, i) => {
          const next = steps[i + 1];
          const reached = s.state === 'done' && next != null && next.state !== 'upcoming';
          return (
            <li
              key={s.key}
              className="relative grid grid-cols-[1.25rem_1fr] gap-x-4 pb-6 last:pb-0 sm:block sm:pr-3 sm:pb-0"
              aria-current={s.state === 'current' ? 'step' : undefined}
            >
              {next && (
                <>
                  {/* Vertical on a phone, horizontal from sm. */}
                  <span
                    aria-hidden
                    className="absolute top-6 bottom-1 left-2.25 w-px sm:hidden"
                    style={{ background: reached ? 'var(--accent)' : 'var(--border)' }}
                  />
                  <span
                    aria-hidden
                    className="absolute top-2.5 right-0 left-8 hidden h-px sm:block"
                    style={{
                      background: reached
                        ? 'var(--accent)'
                        : s.state === 'done'
                          ? 'linear-gradient(90deg, var(--accent), var(--border))'
                          : 'var(--border)',
                    }}
                  />
                </>
              )}
              <StepDot state={s.state} />
              <div className="sm:mt-4">
                <div
                  className={`text-sm font-medium ${s.state === 'upcoming' ? 'text-(--text-muted)' : 'text-(--text-primary)'}`}
                >
                  {s.label}
                </div>
                {s.date && (
                  <div className="mt-0.5 text-[0.8125rem] text-(--text-secondary) tabular-nums">
                    {s.date}
                  </div>
                )}
                {s.note && (
                  <div
                    className={`mt-0.5 text-xs ${s.state === 'current' ? 'text-(--accent)' : 'text-(--text-muted)'}`}
                  >
                    {s.note}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function StepDot(props: { state: Milestone['state'] }) {
  if (props.state === 'done') {
    return (
      <span className="relative z-1 grid h-5 w-5 place-items-center rounded-full bg-(--accent) text-(--on-accent)">
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden>
          <path
            d="M2.5 6.2 5 8.5l4.5-5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (props.state === 'current') {
    return (
      <span className="journey-current relative z-1 grid h-5 w-5 place-items-center rounded-full border border-(--accent) bg-(--surface-1)">
        <span className="h-2 w-2 rounded-full bg-(--accent)" />
      </span>
    );
  }
  return (
    <span className="relative z-1 block h-5 w-5 rounded-full border border-(--border) bg-(--surface-1)" />
  );
}

function DeliveryCard(props: {
  journey: OrderJourneyDto;
  appt: AppointmentView | null;
  delivered: boolean;
}) {
  const { journey, appt, delivered } = props;
  const lookup = journey.delivery;
  const delivery = lookup?.ok ? lookup.value : null;
  const window = journey.detail.ok ? journey.detail.value?.estimatedDelivery : null;
  const relative = !delivered && appt ? relativeDay(appt.daysAway) : null;

  return (
    <Panel
      title="Delivery"
      action={
        delivered ? (
          <Badge color="var(--accent)">Delivered</Badge>
        ) : relative ? (
          <Badge color="var(--accent)">{relative}</Badge>
        ) : null
      }
    >
      {lookup && !lookup.ok ? (
        <Quiet
          title="Couldn’t reach Rivian’s delivery service"
          body="That isn’t the same as no appointment: RivianMate will ask again shortly."
        />
      ) : !appt ? (
        <Quiet
          title={delivered ? 'No appointment on record' : 'Not scheduled yet'}
          body={
            delivered
              ? 'Rivian has no delivery appointment on this order.'
              : window?.start
                ? `Rivian estimates delivery between ${calendarDate(window.start, false)} and ${calendarDate(window.end) ?? 'later'}. The appointment shows here as soon as it’s set.`
                : 'Rivian books the delivery once your vehicle is ready. It shows here as soon as it’s set.'
          }
        />
      ) : (
        <>
          <div className="mt-1 flex items-center gap-5">
            <CalendarPage calendar={{ month: appt.month, days: appt.day, year: appt.year }} />
            <div className="min-w-0">
              <div className="text-xl leading-tight font-medium tracking-[-0.01em]">
                {appt.weekday}, {appt.date}
              </div>
              {appt.time && (
                <div className="mt-1 text-(--text-secondary) tabular-nums">
                  {appt.time}
                  {appt.zone && <span className="text-(--text-muted)"> {appt.zone}</span>}
                </div>
              )}
            </div>
          </div>
          <dl className="mt-5 space-y-2.5 border-t border-(--hairline) pt-4 text-sm">
            {delivery?.address && (
              <Fact label="Where">
                <span className="block">{delivery.address.line1}</span>
                <span className="block text-(--text-muted)">
                  {[placeLine(delivery.address), delivery.address.zipcode]
                    .filter(Boolean)
                    .join(' ')}
                </span>
              </Fact>
            )}
            {delivery?.carrier && (
              <Fact label="Delivered by">{carrierLabel(delivery.carrier)}</Fact>
            )}
            {delivery?.status && (
              <Fact label="Appointment">{deliveryStatusLabel(delivery.status)}</Fact>
            )}
          </dl>
        </>
      )}
    </Panel>
  );
}

function BuildCard(props: { journey: OrderJourneyDto; generation: string | null; model: string }) {
  const { journey } = props;
  if (!journey.detail.ok) {
    return (
      <Panel title="Build">
        <Quiet
          title="Couldn’t load the order from Rivian"
          body="RivianMate will ask again shortly."
        />
      </Panel>
    );
  }
  const vehicle = journey.detail.value?.vehicle ?? null;
  const built = calendarDate(vehicle?.actualGeneralAssemblyDate);
  const planned = calendarDate(vehicle?.plannedBuildDate ?? vehicle?.expectedBuildDate);
  return (
    <Panel title="Build">
      {!vehicle ? (
        <Quiet
          title="Not assigned to a build yet"
          body="Rivian ties the order to a vehicle, and its VIN, as its build nears."
        />
      ) : (
        <>
          <div className="mt-1">
            <div className="eyebrow">VIN</div>
            <div className="mt-1.5 font-mono text-[1.0625rem] tracking-[0.08em] break-all select-all">
              {vehicle.vin ?? '—'}
            </div>
          </div>
          <dl className="mt-5 space-y-2.5 border-t border-(--hairline) pt-4 text-sm">
            <Fact label="Model">{modelLine(vehicle, props.model)}</Fact>
            {props.generation && <Fact label="Platform">{props.generation}</Fact>}
            {built ? (
              <Fact label="Built">{built}</Fact>
            ) : (
              planned && <Fact label="Planned build">{planned}</Fact>
            )}
            {vehicle.status && <Fact label="Status">{vehicleStatusLabel(vehicle.status)}</Fact>}
          </dl>
        </>
      )}
    </Panel>
  );
}

function Fact(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="shrink-0 text-(--text-secondary)">{props.label}</dt>
      <dd className="min-w-0 text-right">{props.children}</dd>
    </div>
  );
}

function Badge(props: { color: string; children: ReactNode }) {
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        color: props.color,
        background: `color-mix(in srgb, ${props.color} 12%, transparent)`,
      }}
    >
      {props.children}
    </span>
  );
}

function Quiet(props: { title: string; body: string }) {
  return (
    <div className="mt-1 py-2">
      <div className="font-medium">{props.title}</div>
      <p className="mt-1 max-w-lg text-sm leading-relaxed text-(--text-secondary)">{props.body}</p>
    </div>
  );
}

function Footnote(props: {
  delivered: boolean;
  orderId: string;
  checkedAt: string | null;
  refreshMinutes: number;
  now: Date;
}) {
  const ago = props.checkedAt ? sinceLabel(props.checkedAt, props.now) : null;
  return (
    <p className="mx-auto mt-10 max-w-160 text-center text-xs leading-relaxed text-(--text-muted)">
      {props.delivered ? (
        <>From Rivian order {props.orderId}.</>
      ) : (
        <>
          Statuses come from Rivian and can trail your vehicle by a few days.
          {ago && ` Checked ${ago};`} RivianMate asks again every {props.refreshMinutes} minutes,
          and starts logging on its own once your Rivian is delivered.
        </>
      )}
    </p>
  );
}

function sinceLabel(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}
