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
