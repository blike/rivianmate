import type { ReactNode } from 'react';

function NavIcon(props: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {props.children}
    </svg>
  );
}

export function CarIcon() {
  return (
    <NavIcon>
      <path d="M2.5 10V8.2l1.3-3.1A1.5 1.5 0 0 1 5.2 4h5.6a1.5 1.5 0 0 1 1.4 1.1l1.3 3.1V10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1ZM2.5 8.5h11M4.5 11v1.5M11.5 11v1.5" />
    </NavIcon>
  );
}

export function BoltIcon() {
  return (
    <NavIcon>
      <path d="M9 1.5 3.5 9h4l-.5 5.5L12.5 7h-4L9 1.5Z" />
    </NavIcon>
  );
}

export function BellIcon() {
  return (
    <NavIcon>
      <path d="M4 6.5a4 4 0 1 1 8 0c0 3 1.5 4.5 1.5 4.5h-11S4 9.5 4 6.5ZM6.5 13.5a1.5 1.5 0 0 0 3 0" />
    </NavIcon>
  );
}

export function PulseIcon() {
  return (
    <NavIcon>
      <path d="M1.5 8h3l1.5-4 3 8 1.5-4h4" />
    </NavIcon>
  );
}

export function LockIcon() {
  return (
    <NavIcon>
      <path d="M4 7.5V5.5a4 4 0 0 1 8 0v2M3.5 7.5h9v6h-9z" />
    </NavIcon>
  );
}

export function InfoIcon() {
  return (
    <NavIcon>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.5v3.5M8 5h.01" />
    </NavIcon>
  );
}

export function DatabaseIcon() {
  return (
    <NavIcon>
      <ellipse cx="8" cy="4" rx="5" ry="1.8" />
      <path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8" />
    </NavIcon>
  );
}
