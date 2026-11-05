import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';

/**
 * While true, Row, StatTiles, etc. render a placeholder in place of their value,
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
  return <span aria-hidden className={`skeleton ${props.className ?? ''}`} style={props.style} />;
}

/** Full-width placeholder block, e.g. for a chart or map. */
export function SkeletonBlock(props: { height: number | string; className?: string }) {
  return (
    <div
      aria-hidden
      className={`skeleton skeleton-block ${props.className ?? ''}`}
      style={{ height: props.height }}
    />
  );
}

/** Placeholder rows matching a `text-sm` table row with `py-2` cells. */
export function SkeletonRows(props: { rows: number }) {
  return (
    <div aria-busy>
      {Array.from({ length: props.rows }, (_, i) => (
        <div key={i} className="border-t border-(--border) py-2 first:border-t-0">
          <SkeletonBlock height="1.25rem" />
        </div>
      ))}
    </div>
  );
}

/** A spinner and "Loading", for content on its way. */
export function LoadingNote(props: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs text-(--text-secondary) ${props.className ?? ''}`}
    >
      <span
        aria-hidden
        className="h-3 w-3 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin"
      />
      Loading
    </span>
  );
}

/**
 * Content still showing the last period's data while the new one loads:
 * dimmed, with a note in its middle. Both wait a moment, so a quick load
 * doesn't flash; a refresh of data already shown doesn't count.
 */
export function Stale(props: {
  stale: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      aria-busy={props.stale || undefined}
      className={`relative ${props.className ?? ''}`}
      style={props.style}
    >
      <div className="stale-content h-full" data-stale={props.stale || undefined}>
        {props.children}
      </div>
      {props.stale && (
        <div
          aria-hidden
          className="delayed-fade-in pointer-events-none absolute inset-0 z-1000 grid place-items-center"
        >
          <LoadingNote className="rounded-full border border-(--hairline) bg-(--surface-2) px-2.5 py-1 shadow-sm" />
        </div>
      )}
    </div>
  );
}

/**
 * Reserves `height` for a chart or map: a placeholder saying it's loading, a
 * centred message when there is nothing to show, otherwise the content
 * (which should render at the same height), dimmed while `stale`.
 */
export function ContentFrame(props: {
  height: number | string;
  loading: boolean;
  stale?: boolean;
  empty: boolean;
  emptyText: ReactNode;
  children: ReactNode;
}) {
  // The last period having nothing says nothing about this one, so that's loading too.
  if (props.loading || (props.stale && props.empty)) {
    // Says so in its middle too, once loading has taken a moment.
    return (
      <div aria-busy className="relative" style={{ height: props.height }}>
        <SkeletonBlock height="100%" />
        <div aria-hidden className="delayed-fade-in absolute inset-0 grid place-items-center">
          <LoadingNote />
        </div>
      </div>
    );
  }
  if (props.empty) {
    return (
      <div
        className="flex items-center justify-center px-4 text-center text-sm text-(--text-muted)"
        style={{ height: props.height }}
      >
        {props.emptyText}
      </div>
    );
  }
  if (props.stale === undefined) return <>{props.children}</>;
  // A map fills a frame sized by its parent, so the frame has to as well.
  const fills = typeof props.height === 'string' && props.height.endsWith('%');
  return (
    <Stale stale={props.stale} style={fills ? { height: props.height } : undefined}>
      {props.children}
    </Stale>
  );
}
