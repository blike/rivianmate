import type { ReactNode } from 'react';

/** A page's title, with what it's about above it and its controls at the right. */
export function PageHeader(props: { title: ReactNode; kicker?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 lg:mb-8">
      <div className="min-w-0">
        {props.kicker && <div className="eyebrow mb-1.5">{props.kicker}</div>}
        <h1 className="truncate text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] sm:text-[2rem]">
          {props.title}
        </h1>
      </div>
      {props.action}
    </header>
  );
}

/** A section's name, with a hairline running to its controls. */
export function SectionRule(props: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-4">
      <h2 className="eyebrow shrink-0 text-(--text-secondary)">{props.children}</h2>
      <span aria-hidden className="h-px flex-1 bg-(--hairline)" />
      {props.action}
    </div>
  );
}
