/**
 * A small status dot. Pulsing ripples in the dot's own color, which is why
 * the color is set as both the background and the text color.
 */
export function Dot(props: {
  color: string;
  pulse?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const size = props.size === 'md' ? 'h-2 w-2' : 'h-1.5 w-1.5';
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${size} ${props.pulse ? 'chip-dot--pulse' : ''} ${props.className ?? ''}`}
      style={{ background: props.color, color: props.color }}
    />
  );
}

/** Good, needs attention, or unknown (null). */
export function StatusDot(props: { ok: boolean | null }) {
  const color =
    props.ok == null
      ? 'var(--text-muted)'
      : props.ok
        ? 'var(--status-good)'
        : 'var(--status-warning)';
  return <Dot color={color} size="md" />;
}
