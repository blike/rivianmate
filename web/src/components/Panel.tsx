import type { ReactNode } from 'react';
import { Skeleton, useLoading } from './LoadingState';

/** A titled card; `action` sits at the right of the title. */
export function Panel(props: {
  title: string;
  className?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const heading = <h3 className="text-sm font-medium text-(--text-secondary)">{props.title}</h3>;
  return (
    <section className={`card p-4 ${props.className ?? ''}`}>
      {props.action ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {heading}
          {props.action}
        </div>
      ) : (
        <div className="mb-3">{heading}</div>
      )}
      {props.children}
    </section>
  );
}

/** A label and its value, for a `<dl>`. */
export function Row(props: { label: string; value: ReactNode }) {
  const loading = useLoading();
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-(--text-secondary)">{props.label}</dt>
      <dd className="tabular-nums">{loading ? <Skeleton className="w-[5em]" /> : props.value}</dd>
    </div>
  );
}
