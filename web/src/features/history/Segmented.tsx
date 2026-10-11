export function Segmented(props: {
  items: string[];
  value: number;
  onChange: (i: number) => void;
}) {
  return (
    <div className="flex shrink-0 rounded-md border border-(--border) p-0.5">
      {props.items.map((label, i) => (
        <button
          key={label}
          onClick={() => props.onChange(i)}
          aria-pressed={i === props.value}
          className={`rounded px-2.5 py-1 text-xs ${
            i === props.value
              ? 'bg-(--surface-2) text-(--text-primary)'
              : 'text-(--text-secondary) hover:text-(--text-primary)'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
