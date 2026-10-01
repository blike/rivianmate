import { createContext, useContext, type CSSProperties, type ReactNode } from "react";

/**
 * While true, Row/StatCard/etc. render a placeholder in place of their value,
 * so a panel keeps its final shape while its data loads.
 */
const LoadingContext = createContext(false);

export function LoadingScope(props: { loading: boolean; children: ReactNode }) {
  return <LoadingContext.Provider value={props.loading}>{props.children}</LoadingContext.Provider>;
}

export function useLoading(): boolean {
  return useContext(LoadingContext);
}

/** Inline placeholder sized in `em`, so it fits the text it stands in for. */
export function Skeleton(props: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={`skeleton ${props.className ?? ""}`} style={props.style} />;
}

/** Full-width placeholder block, e.g. for a chart or map. */
export function SkeletonBlock(props: { height: number | string; className?: string }) {
  return (
    <div
      aria-hidden
      className={`skeleton skeleton-block ${props.className ?? ""}`}
      style={{ height: props.height }}
    />
  );
}

/** Placeholder rows matching a `text-sm` table row with `py-2` cells. */
export function SkeletonRows(props: { rows: number }) {
  return (
    <div aria-busy>
      {Array.from({ length: props.rows }, (_, i) => (
        <div key={i} className="border-t border-[var(--border)] py-2 first:border-t-0">
          <SkeletonBlock height="1.25rem" />
        </div>
      ))}
    </div>
  );
}

/**
 * Reserves `height` for a chart or map: a placeholder while loading, a
 * centred message when there is nothing to show, otherwise the content
 * (which should render at the same height).
 */
export function ContentFrame(props: {
  height: number | string;
  loading: boolean;
  empty: boolean;
  emptyText: ReactNode;
  children: ReactNode;
}) {
  if (props.loading) return <SkeletonBlock height={props.height} />;
  if (props.empty) {
    return (
      <div
        className="flex items-center justify-center px-4 text-center text-sm text-[var(--text-muted)]"
        style={{ height: props.height }}
      >
        {props.emptyText}
      </div>
    );
  }
  return <>{props.children}</>;
}
