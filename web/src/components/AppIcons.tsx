import type { ReactNode } from 'react';

/** 20px line icons on a 24 grid, drawn to share one stroke and corner style. */
function Icon(props: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={props.className}
    >
      {props.children}
    </svg>
  );
}

/** A gauge needle: the vehicle right now. */
export function OverviewIcon() {
  return (
    <Icon>
      <path d="M4.5 17a8 8 0 1 1 15 0" />
      <path d="m12 13 3.5-4" />
      <circle cx="12" cy="13" r="1.25" />
    </Icon>
  );
}

/** A trace over time. */
export function HistoryIcon() {
  return (
    <Icon>
      <path d="M3.5 19.5h17" />
      <path d="m4 15 4.5-5 3.5 3.5L19.5 6" />
    </Icon>
  );
}

export function DrivesIcon() {
  return (
    <Icon>
      <circle cx="6" cy="18.5" r="2" />
      <path d="M8 18.5h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16" />
      <circle cx="18" cy="4.5" r="2" />
    </Icon>
  );
}

export function ChargingIcon() {
  return (
    <Icon>
      <path d="M13 3 5.5 13.5h6L10.5 21 18.5 10.5h-6z" />
    </Icon>
  );
}

/** A pulse inside a cell. */
export function HealthIcon() {
  return (
    <Icon>
      <rect x="3" y="6.5" width="16" height="11" rx="2.5" />
      <path d="M21 10.5v3" />
      <path d="M6.5 12h2.5l1.5-2.5 2 5 1.5-2.5h2" />
    </Icon>
  );
}

export function SettingsIcon() {
  return (
    <Icon>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </Icon>
  );
}
