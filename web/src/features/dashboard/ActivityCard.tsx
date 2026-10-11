import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton, useLoading } from '../../components/LoadingState';

export function ActivityCard(props: {
  to: string;
  title: string;
  when: ReactNode;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      to={props.to}
      className="card activity-card group flex flex-col gap-4 p-5 transition-colors hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-(--surface-2) text-(--accent)">
            {props.icon}
          </span>
          <span className="text-sm font-medium">{props.title}</span>
        </span>
        <span className="flex items-center gap-2 text-xs text-(--text-muted)">
          {props.when}
          <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>
            →
          </span>
        </span>
      </div>
      {props.children}
    </Link>
  );
}

export function ActivityStats(props: { items: { label: string; value: ReactNode }[] }) {
  const loading = useLoading();
  return (
    <dl
      className={`grid gap-3 ${props.items.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}
    >
      {props.items.map((i) => (
        <div key={i.label}>
          <dt className="text-[11px] uppercase tracking-wide text-(--text-muted)">{i.label}</dt>
          <dd className="mt-0.5 text-sm font-medium tabular-nums">
            {loading ? <Skeleton className="w-[4em]" /> : i.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
