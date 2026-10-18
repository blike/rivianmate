import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton, useLoading } from '../../components/LoadingState';

/**
 * A dashboard card for the last or current drive or charge. Every kind and
 * state has the same rows (ActivityLine, ActivityBar, ActivityStats), so the
 * cards stay level and keep their height as a drive or charge starts and ends.
 */
export function ActivityCard(props: {
  to: string;
  title: ReactNode;
  when: ReactNode;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      to={props.to}
      className="card activity-card flex h-full flex-col gap-4 p-5 transition-colors hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-(--surface-2) text-(--accent)">
            {props.icon}
          </span>
          <span className="text-sm font-medium">{props.title}</span>
        </span>
        <span className="flex items-center gap-2 text-xs text-(--text-muted)">{props.when}</span>
      </div>
      {props.children}
    </Link>
  );
}

/** One line naming where: truncated rather than wrapped, with a quieter note on the right. */
export function ActivityLine(props: {
  children: ReactNode;
  note?: ReactNode;
  /** Wrap onto more lines rather than cut off, like a route's two places. */
  wrap?: boolean;
}) {
  const loading = useLoading();
  return (
    <div className="flex min-w-0 items-baseline gap-2 text-base font-medium">
      {loading ? (
        // In a span, so the row keeps a full line's height while it loads.
        <span>
          <Skeleton className="w-[14em]" />
        </span>
      ) : (
        <>
          <span
            className={
              props.wrap
                ? 'flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2'
                : 'min-w-0 flex-1 truncate'
            }
          >
            {props.children}
          </span>
          {props.note && (
            <span className="shrink-0 text-xs font-normal tabular-nums text-(--text-muted)">
              {props.note}
            </span>
          )}
        </>
      )}
    </div>
  );
}

export interface BarSegment {
  /** Percent along the bar, 0–100. */
  from: number;
  to: number;
  color: string;
}

/**
 * A slim bar of colored segments, optionally with a tick (a charge limit)
 * or a dot (the vehicle along its route), and a caption under it.
 */
export function ActivityBar(props: {
  segments: BarSegment[];
  tick?: number | null;
  dot?: { at: number; color: string } | null;
  left: ReactNode;
  right?: ReactNode;
  label?: string;
}) {
  const loading = useLoading();
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  return (
    <div>
      <div
        className="relative h-1.5 rounded-full bg-(--surface-2)"
        role={props.label ? 'img' : undefined}
        aria-label={props.label}
        aria-hidden={props.label ? undefined : true}
      >
        {!loading &&
          props.segments
            .filter((seg) => seg.to > seg.from)
            .map((seg, i) => (
              <span
                key={i}
                className="absolute inset-y-0 rounded-full transition-[left,width] duration-700"
                style={{
                  left: `${clamp(seg.from)}%`,
                  width: `${clamp(seg.to) - clamp(seg.from)}%`,
                  background: seg.color,
                }}
              />
            ))}
        {props.tick != null && (
          <span
            className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-(--text-secondary)"
            style={{ left: `calc(${clamp(props.tick)}% - 1px)` }}
          />
        )}
        {props.dot && !loading && (
          <span
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-(--surface-1)"
            style={{ left: `${clamp(props.dot.at)}%`, background: props.dot.color }}
          />
        )}
      </div>
      <div className="mt-1.5 flex justify-between gap-3 text-xs tabular-nums text-(--text-muted)">
        {loading ? (
          <span>
            <Skeleton className="w-[10em]" />
          </span>
        ) : (
          <>
            <span className="truncate">{props.left}</span>
            {props.right && <span className="shrink-0">{props.right}</span>}
          </>
        )}
      </div>
    </div>
  );
}

/** Three figures. Labels load too, since which figures show depends on the data. */
export function ActivityStats(props: { items: { label: string; value: ReactNode }[] }) {
  const loading = useLoading();
  return (
    <dl className="grid grid-cols-3 gap-3">
      {props.items.map((i) => (
        <div key={i.label}>
          <dt className="text-[11px] uppercase tracking-wide text-(--text-muted)">
            {loading ? <Skeleton className="w-[6em]" /> : i.label}
          </dt>
          <dd className="mt-0.5 truncate text-sm font-medium tabular-nums">
            {loading ? <Skeleton className="w-[4em]" /> : i.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
