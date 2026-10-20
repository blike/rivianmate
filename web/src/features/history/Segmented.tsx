/** A pill of options, one chosen. */
export function Segmented(props: {
  items: string[];
  value: number;
  onChange: (i: number) => void;
  label?: string;
  size?: 'sm' | 'md';
}) {
  const md = props.size === 'md';
  return (
    <div
      role="group"
      aria-label={props.label}
      className="flex shrink-0 rounded-full border border-(--hairline) bg-(--surface-1) p-0.5"
    >
      {props.items.map((label, i) => (
        <button
          key={label}
          type="button"
          onClick={() => props.onChange(i)}
          aria-pressed={i === props.value}
          className={`rounded-full font-medium tabular-nums transition-colors ${md ? 'px-3.5 py-1.5 text-sm' : 'px-2.5 py-1 text-xs'} ${
            i === props.value
              ? 'bg-(--surface-3) text-(--text-primary) shadow-[inset_0_1px_0_rgb(255_255_240/0.06)]'
              : 'text-(--text-muted) hover:text-(--text-primary)'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
