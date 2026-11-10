/** One end of a list read a page at a time: whether there's more past it, and reading it. */
export interface ListEnd {
  has: boolean;
  loading: boolean;
  load: () => void;
}

/** The top of a list opened part way back: it can also go straight back to the newest. */
export interface NewerEnd extends ListEnd {
  latest: () => void;
}

/** The end of a list read a page at a time: a row that reads the next, older page. */
export function LoadOlder(props: { label: string; loading: boolean; onLoad: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onLoad}
      disabled={props.loading}
      aria-busy={props.loading}
      className="w-full border-t border-(--border) px-4 py-3 text-center text-sm text-(--accent) transition-colors hover:bg-(--surface-2) disabled:cursor-wait disabled:text-(--text-muted) disabled:hover:bg-transparent"
    >
      {props.loading ? 'Loading…' : props.label}
    </button>
  );
}

/**
 * The top of a list opened part way back (at a date): a row that reads the
 * page of newer records above, and one that goes back to the newest.
 */
export function LoadNewer(props: {
  /** e.g. "drives". */
  nouns: string;
  loading: boolean;
  onLoad: () => void;
  onLatest: () => void;
}) {
  return (
    <div className="flex items-stretch border-b border-(--border) text-sm">
      <button
        type="button"
        onClick={props.onLoad}
        disabled={props.loading}
        aria-busy={props.loading}
        className="flex-1 px-4 py-3 text-center text-(--accent) transition-colors hover:bg-(--surface-2) disabled:cursor-wait disabled:text-(--text-muted) disabled:hover:bg-transparent"
      >
        {props.loading ? 'Loading…' : `Show newer ${props.nouns}`}
      </button>
      <button
        type="button"
        onClick={props.onLatest}
        className="border-l border-(--border) px-4 py-3 text-(--text-secondary) transition-colors hover:bg-(--surface-2) hover:text-(--text-primary)"
      >
        Back to latest
      </button>
    </div>
  );
}
