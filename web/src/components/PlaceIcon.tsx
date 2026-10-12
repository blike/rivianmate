import { HomeIcon } from './HomeIcon';

/** A house for home, a pin for another saved location, nothing elsewhere. */
export function PlaceIcon(props: { isHome: boolean; saved: boolean }) {
  if (props.isHome) return <HomeIcon />;
  if (!props.saved) return null;
  return (
    <svg
      viewBox="0 0 16 16"
      className="mr-1.5 inline h-[0.85em] w-[0.85em] -translate-y-px text-(--accent)"
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 1a5 5 0 0 0-5 5c0 3.6 5 9 5 9s5-5.4 5-9a5 5 0 0 0-5-5Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" />
    </svg>
  );
}
