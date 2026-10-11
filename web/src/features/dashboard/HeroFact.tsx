import type { ReactNode } from 'react';
import { Skeleton, useLoading } from '../../components/LoadingState';

export function HeroFact(props: { label: string; value: ReactNode }) {
  const loading = useLoading();
  return (
    <div className="bg-(--surface-1) px-3 py-2.5 last:max-sm:col-span-2">
      <dt className="text-[11px] uppercase tracking-wide text-(--text-muted)">{props.label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium tabular-nums">
        {loading ? <Skeleton className="w-[5em]" /> : props.value}
      </dd>
    </div>
  );
}
