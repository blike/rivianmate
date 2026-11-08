import { Panel } from '../../components/Panel';
import { useUnits } from '../../api/hooks';
import { plural, shortDate } from '../../lib/format';
import { type RoutePoint, type Stay, staysSummary } from './insights';
import { dayStart } from './trips';

/** The stays panel's anchor, for the header line's "See all". */
const STAYS_ID = 'trip-stays';

const nightsLabel = (n: number) => plural(n, 'night');

/** Arrived and left, as a booking reads: "Oct 25 – 28", or across months "Oct 31 – Nov 2". */
function stayDates(stay: Stay): string {
  const from = dayStart(stay.from);
  const to = new Date(from);
  to.setDate(to.getDate() + stay.nights);
  return `${shortDate(from.getTime())} – ${from.getMonth() === to.getMonth() ? to.getDate() : shortDate(to.getTime())}`;
}

/**
 * Where the trip slept, in a line: "2 nights at Jumbo Rocks", "4 nights ·
 * Jumbo Rocks 2, Las Vegas, Zion", or for many, "10 nights in 9 places ·
 * Zion 3, Anza-Borrego, Joshua Tree, +6 more · See all". Nothing for a trip
 * that never slept away from home.
 */
export function NightsLine(props: { stays: readonly Stay[] }) {
  const s = staysSummary(props.stays);
  if (!s) return null;
  const only = s.places === 1 ? s.named[0] : null;
  return (
    <p className="mt-2 flex items-start gap-2 text-sm text-(--text-secondary)">
      <span className="mt-1 text-(--text-muted)">
        <MoonIcon />
      </span>
      <span className="min-w-0">
        {only ? (
          <>
            {nightsLabel(s.nights)} at <span className="text-(--text-primary)">{only.place}</span>
          </>
        ) : (
          <>
            {nightsLabel(s.nights)}
            {s.more > 0 && ` in ${s.places} places`} ·{' '}
            {s.named.map((p, i) => (
              <span key={p.place}>
                {i > 0 && ', '}
                <span className="text-(--text-primary)">{p.place}</span>
                {p.nights > 1 && (
                  <span className="text-(--text-muted) tabular-nums"> {p.nights}</span>
                )}
              </span>
            ))}
            {s.more > 0 && <span className="text-(--text-muted)">, +{s.more} more</span>}
          </>
        )}
        {s.homeNights > 0 && (
          <span className="text-(--text-muted)"> · {nightsLabel(s.homeNights)} at home</span>
        )}
        {s.more > 0 && (
          <>
            {' · '}
            <a
              href={`#${STAYS_ID}`}
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById(STAYS_ID)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="text-(--accent) hover:underline"
            >
              See all
            </a>
          </>
        )}
      </span>
    </p>
  );
}

/**
 * The journey as a vertical itinerary: where it set out, each place it spent
 * the night with its dates, and where it finished, or where it is now on a
 * trip under way, with the distance driven between them on the line. A stay
 * that began on a day driven shows that day on the map. Shown with two or
 * more stays: one is said in full by the header's line.
 */
export function StaysPanel(props: {
  route: readonly RoutePoint[];
  /** Under way: the last point is where it is now, not where it finished. */
  underWay: boolean;
  /** Days with drives or charges, which the map can show. */
  driven: ReadonlySet<string>;
  focusDay: string | null;
  onFocusDay: (day: string | null) => void;
}) {
  const u = useUnits();
  const { route } = props;
  return (
    <div id={STAYS_ID} className="scroll-mt-4">
      <Panel title="Where you stayed">
        <ol>
          {route.map((p, i) => {
            const next = route[i + 1];
            const km = next && next.kind !== 'start' ? next.kmBefore : 0;
            return (
              <li
                key={p.kind === 'stay' ? p.stay.from : p.kind}
                className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3"
              >
                {next && (
                  <span
                    aria-hidden
                    className="absolute top-6 bottom-1 left-[calc(0.625rem-0.5px)] w-px bg-(--border)"
                  />
                )}
                <Marker point={p} />
                <div className={next ? 'pb-2' : ''}>
                  <PointRow
                    point={p}
                    underWay={props.underWay}
                    picked={p.kind === 'stay' && props.focusDay === p.stay.from}
                    canShow={p.kind === 'stay' && props.driven.has(p.stay.from)}
                    onFocusDay={props.onFocusDay}
                  />
                  {km > 0 && (
                    <div className="py-1.5 text-xs text-(--text-muted) tabular-nums">
                      {u.formatDistance(km)}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Panel>
    </div>
  );
}

/** A point's dot on the line: a moon for a night's stay, a ring where it set out and ended. */
function Marker(props: { point: RoutePoint }) {
  const { point } = props;
  if (point.kind === 'stay') {
    return (
      <span
        className={`relative mt-1 flex size-5 items-center justify-center rounded-full ${
          point.stay.isHome
            ? 'bg-(--surface-3) text-(--text-muted)'
            : 'bg-[color-mix(in_srgb,var(--accent)_18%,var(--surface-1))] text-(--accent)'
        }`}
      >
        <MoonIcon />
      </span>
    );
  }
  return (
    <span className="relative mt-1.5 ml-[0.1875rem] size-3.5 rounded-full border-2 border-(--text-muted) bg-(--surface-1)" />
  );
}

function PointRow(props: {
  point: RoutePoint;
  underWay: boolean;
  picked: boolean;
  canShow: boolean;
  onFocusDay: (day: string | null) => void;
}) {
  const { point } = props;
  const place = point.kind === 'stay' ? point.stay.place : point.place;
  const isHome = point.kind === 'stay' ? point.stay.isHome : point.isHome;
  const meta =
    point.kind === 'start'
      ? `Set out ${shortDate(point.at)}`
      : point.kind === 'end'
        ? props.underWay
          ? `Latest, ${shortDate(point.at)}`
          : `${isHome ? 'Back' : 'Finished'} ${shortDate(point.at)}`
        : `${stayDates(point.stay)} · ${nightsLabel(point.stay.nights)}`;
  const body = (
    <>
      <span className={`truncate font-medium ${isHome ? 'text-(--text-secondary)' : ''}`}>
        {place}
      </span>
      <span className="shrink-0 text-xs text-(--text-muted) tabular-nums">{meta}</span>
    </>
  );
  const row =
    'flex min-h-7 w-full items-baseline justify-between gap-3 rounded-md px-2 py-1 text-sm';
  if (point.kind !== 'stay') return <div className={`${row} -mx-2`}>{body}</div>;
  return (
    <button
      type="button"
      disabled={!props.canShow}
      aria-pressed={props.picked}
      title={props.canShow ? 'Show the day it arrived on the map' : undefined}
      onClick={() => props.onFocusDay(props.picked ? null : point.stay.from)}
      className={`${row} -mx-2 w-[calc(100%+1rem)] text-left transition-colors enabled:hover:bg-(--surface-2) ${
        props.picked ? 'bg-(--surface-2)' : ''
      }`}
    >
      {body}
    </button>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3 shrink-0 fill-current">
      <path d="M10.5 1.6a6.5 6.5 0 1 0 3.9 11.2A5.5 5.5 0 0 1 10.5 1.6Z" />
    </svg>
  );
}
