import type { ReactNode } from 'react';

export function SectionHeading(props: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-(--text-muted)">
        {props.children}
      </h2>
      {props.action}
    </div>
  );
}
