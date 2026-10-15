import { useLoading } from './LoadingState';

/**
 * Battery level toward the charge limit: filled to now, the part this
 * charge added brighter, and the limit marked.
 */
export function SocTrack(props: {
  soc: number | null;
  limit: number | null;
  /** Where this charge started, when known. */
  start?: number | null;
  className?: string;
}) {
  const loading = useLoading();
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const soc = clamp(props.soc ?? 0);
  const start = props.start != null ? Math.min(clamp(props.start), soc) : null;
  return (
    <div className={`relative h-2 rounded-full bg-(--surface-2) ${props.className ?? ''}`}>
      {!loading && (
        <>
          {start != null && (
            <div
              className="absolute inset-y-0 left-0 rounded-l-full bg-[color-mix(in_srgb,var(--status-good)_35%,var(--surface-2))]"
              style={{ width: `${start}%` }}
            />
          )}
          <div
            className="absolute inset-y-0 rounded-full bg-(--status-good) transition-[width] duration-700"
            style={
              start != null
                ? { left: `${start}%`, width: `${soc - start}%` }
                : { left: 0, width: `${soc}%` }
            }
          />
        </>
      )}
      {props.limit != null && (
        <span
          aria-hidden
          title={`${Math.round(props.limit)}% limit`}
          className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-(--text-secondary)"
          style={{ left: `calc(${clamp(props.limit)}% - 1px)` }}
        />
      )}
    </div>
  );
}
