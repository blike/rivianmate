import type { VehicleState } from '@server/api-types';
import { Dot } from '../../components/Dot';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { Skeleton, useLoading } from '../../components/LoadingState';
import { type CheckLevel, healthChecks, healthSummary } from './health';
import { LEVEL_COLOR } from './levels';

/** The verdict up front, then each system the vehicle reports on. */
export function Overview(props: { state: VehicleState | undefined }) {
  const loading = useLoading();
  const checks = healthChecks(props.state);
  const summary = healthSummary(checks);
  const color = LEVEL_COLOR[summary.level];

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start gap-4 p-5">
        <span
          aria-hidden
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full"
          style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
        >
          {loading ? null : <SummaryIcon level={summary.level} />}
        </span>
        <div className="min-w-48 flex-1">
          <h2 className="text-lg font-semibold tracking-tight">
            {loading ? <Skeleton className="w-[10em]" /> : summary.title}
          </h2>
          <p className="mt-0.5 text-sm text-(--text-secondary)">
            {loading ? <Skeleton className="w-[18em]" /> : summary.detail}
          </p>
        </div>
        <FreshnessBadge state={props.state} />
      </div>
      {/* Tiles grow to fill each row, however many checks the vehicle reports. */}
      <ul className="flex flex-wrap gap-px border-t border-(--border) bg-(--border)">
        {checks.map((c) => (
          <li key={c.key} className="min-w-0 flex-1 basis-36 bg-(--surface-1) px-4 py-3">
            <div className="text-xs text-(--text-muted)">{c.label}</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-medium">
              {loading ? (
                <Skeleton className="w-[5em]" />
              ) : (
                <>
                  <Dot color={LEVEL_COLOR[c.level]} size="md" />
                  <span
                    className={`truncate ${c.level === 'unknown' ? 'text-(--text-muted)' : ''}`}
                  >
                    {c.value}
                  </span>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SummaryIcon(props: { level: CheckLevel }) {
  const path =
    props.level === 'attention'
      ? 'M8 4v5M8 11.5v.5'
      : props.level === 'unknown'
        ? 'M4.5 8h.01M8 8h.01M11.5 8h.01'
        : 'M3.5 8.5l3 3 6-7';
  return (
    <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
