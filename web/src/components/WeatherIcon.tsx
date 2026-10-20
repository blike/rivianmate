import type { ReactNode } from 'react';
import type { WeatherKind } from '../lib/weather';

/** Line icons on a 24 grid, in the app icons' stroke and corner style. */
function Icon(props: { children: ReactNode; className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
      className={props.className}
    >
      {props.children}
    </svg>
  );
}

const CLOUD = 'M7 18.5h10a3.5 3.5 0 0 0 .6-6.95A5.5 5.5 0 0 0 7 10.5a4 4 0 0 0 0 8Z';
/** The cloud raised to leave room for what falls from it. */
const HIGH_CLOUD = 'M7 14.5h10a3.5 3.5 0 0 0 .6-6.95A5.5 5.5 0 0 0 7 6.5a4 4 0 0 0 0 8Z';
const SUN_RAYS =
  'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4';
const MOON = 'M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5A10 10 0 0 0 19.5 14.5Z';

/** A small sun or moon behind the upper left of a cloud. */
function Partly(props: { night: boolean }) {
  return (
    <>
      <g transform="translate(-1 -1) scale(0.65)">
        {props.night ? (
          <path d={MOON} vectorEffect="non-scaling-stroke" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" vectorEffect="non-scaling-stroke" />
            <path d={SUN_RAYS} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </g>
      <path d={CLOUD} transform="translate(2.5 2)" fill="var(--surface-1)" />
    </>
  );
}

/** Today's sky: sun or moon, cloud, fog, rain, snow or storm. */
export function WeatherIcon(props: {
  kind: WeatherKind;
  night?: boolean;
  label?: string;
  className?: string;
}) {
  const night = props.night ?? false;
  const art: Record<WeatherKind, ReactNode> = {
    clear: night ? (
      <path d={MOON} />
    ) : (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d={SUN_RAYS} />
      </>
    ),
    partly: <Partly night={night} />,
    cloudy: <path d={CLOUD} />,
    fog: (
      <>
        <path d={HIGH_CLOUD} />
        <path d="M5 17.5h14M7.5 20.5h9" />
      </>
    ),
    rain: (
      <>
        <path d={HIGH_CLOUD} />
        <path d="M9 17.5 8 20M13 17.5 12 20M17 17.5 16 20" />
      </>
    ),
    snow: (
      <>
        <path d={HIGH_CLOUD} />
        <path d="M8.5 18h.01M12 20.5h.01M15.5 18h.01" strokeWidth="2.4" />
      </>
    ),
    storm: (
      <>
        <path d={HIGH_CLOUD} />
        <path d="m12.5 15.5-2 3.5h3l-2 3.5" />
      </>
    ),
  };
  return (
    <Icon className={props.className} label={props.label}>
      {art[props.kind]}
    </Icon>
  );
}

/** An arrow pointing the way the wind blows, given where it blows from. */
export function WindArrow(props: { fromDeg: number; className?: string }) {
  return (
    <Icon className={props.className}>
      <g transform={`rotate(${(props.fromDeg + 180) % 360} 12 12)`}>
        <path d="M12 19V5M7 10l5-5 5 5" />
      </g>
    </Icon>
  );
}
