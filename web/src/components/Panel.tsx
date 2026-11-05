import type { ReactNode } from 'react';
import { Skeleton, useLoading } from './LoadingState';

/**
 * A titled card: how every card with a heading is drawn. The heading's line
 * is as tall with an `action` beside it (a control, a legend, a note) as
 * without, so cards side by side start their content level. The line
 * reaches into the padding around it, so a control fits beside the title
 * without pushing it down or the content away. `tight` keeps content that
 * reads as part of the heading (a figure, a caption) close under it;
 * `flush` runs the content to the card's edges (a map), padding only the
 * heading.
 */
export function Panel(props: {
  title: string;
  className?: string;
  action?: ReactNode;
  tight?: boolean;
  flush?: boolean;
  children: ReactNode;
}) {
  const header = (
    <Heading level="h3" title={props.title} action={props.action} tight={props.tight} />
  );
  return (
    <section className={`card ${props.flush ? 'overflow-hidden' : 'p-5'} ${props.className ?? ''}`}>
      {props.flush ? <div className="px-5 pt-5">{header}</div> : header}
      {props.children}
    </section>
  );
}

/**
 * A part of a card below a line, headed like the card itself ("Pack",
 * "Day by day"). `stacked` leaves the space above it to a parent that
 * already spaces its children.
 */
export function PanelSection(props: {
  title: string;
  action?: ReactNode;
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`border-t border-(--hairline) pt-5 ${props.stacked ? '' : 'mt-6'}`}>
      <Heading level="h4" title={props.title} action={props.action} />
      {props.children}
    </section>
  );
}

/** A card's or section's heading line, as tall with an action as without. */
function Heading(props: {
  level: 'h3' | 'h4';
  title: string;
  action?: ReactNode;
  tight?: boolean;
}) {
  const Title = props.level;
  return (
    <div
      className={`-mt-2 flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2 ${
        props.tight ? '' : 'mb-2'
      }`}
    >
      <Title className="eyebrow text-(--text-secondary)">{props.title}</Title>
      {props.action}
    </div>
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
