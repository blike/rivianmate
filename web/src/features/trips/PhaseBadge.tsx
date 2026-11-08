import { type OpenPhase, phaseLabel } from './trips';

/** Where a trip under way or to come stands: "Day 6 of 9", or "Starts in 3 days". */
export function PhaseBadge(props: { phase: OpenPhase }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-(--accent) tabular-nums ring-1 ring-[color-mix(in_srgb,var(--accent)_40%,transparent)] ring-inset">
      {phaseLabel(props.phase)}
    </span>
  );
}
