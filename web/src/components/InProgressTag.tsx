/**
 * Marks a drive or session that's still under way; "In progress" unless it
 * says more. Exactly a line of small text tall, border included, so rows
 * keep their height whether it shows or not.
 */
export function InProgressTag(props: { label?: string; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] px-2 text-[10.5px] leading-[14px] font-medium uppercase tracking-wide text-(--accent) ${props.className ?? ''}`}
    >
      {props.label ?? 'In progress'}
    </span>
  );
}
