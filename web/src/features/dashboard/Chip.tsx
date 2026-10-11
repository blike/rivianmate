import type { ReactNode } from 'react';
import { Dot } from '../../components/Dot';

export function Chip(props: { children: ReactNode; dot?: string; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-(--border) bg-(--surface-2) px-3 py-1 text-xs font-medium text-(--text-primary)">
      {props.dot && <Dot color={props.dot} pulse={props.pulse} />}
      {props.children}
    </span>
  );
}
