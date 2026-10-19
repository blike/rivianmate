export type WheelKey = 'fl' | 'fr' | 'rl' | 'rr';

const OPEN_FILL = 'color-mix(in srgb, var(--status-warning) 28%, transparent)';
const OPEN_STROKE = 'var(--status-warning)';

/** Wheel positions in the 64×128 plan, nose up. */
const WHEEL_AT: Record<WheelKey, [number, number]> = {
  fl: [4, 20],
  fr: [52, 20],
  rl: [4, 84],
  rr: [52, 84],
};

const REAR_GLASS = 'M18 98 Q32 102 46 98 L47 108 Q32 114 17 108 Z';
const CAB_GLASS = 'M18 84 Q32 86 46 84 V87 Q32 89 18 87 Z';
const BED = 'M16 94 H48 V115 H16 Z';

/** Each closure's shape in the plan, lit when open. */
const PARTS: Record<string, string> = {
  closureFrunkClosed: 'M17 12 Q32 7 47 12 L47 34 Q32 29 17 34 Z',
  doorFrontLeftClosed: 'M10 54 H13 V70 H10 Z',
  doorRearLeftClosed: 'M10 72 H13 V86 H10 Z',
  doorFrontRightClosed: 'M51 54 H54 V70 H51 Z',
  doorRearRightClosed: 'M51 72 H54 V86 H51 Z',
  windowFrontLeftClosed: 'M14 55 H16 V69 H14 Z',
  windowRearLeftClosed: 'M14 73 H16 V85 H14 Z',
  windowFrontRightClosed: 'M48 55 H50 V69 H48 Z',
  windowRearRightClosed: 'M48 73 H50 V85 H48 Z',
  // SUV: the liftgate and its glass across the back.
  closureLiftgateClosed: 'M17 96 H47 V114 Q32 122 17 114 Z',
  windowRearGlassClosed: REAR_GLASS,
  // Truck: gear tunnels behind the cab, then the bed under its tonneau, then the tailgate.
  closureSideBinLeftClosed: 'M12 89 H31 V92 H12 Z',
  closureSideBinRightClosed: 'M33 89 H52 V92 H33 Z',
  closureTonneauClosed: BED,
  closureTailgateClosed: 'M18 117 H46 L45 121 Q32 122 19 121 Z',
};

/**
 * The vehicle from above, nose up: wheels in the body's tones unless named in
 * `attention`, and any closure named in `open` lit. Sized by `className`.
 */
export function CarPlan(props: {
  attention?: ReadonlySet<WheelKey>;
  open?: ReadonlySet<string>;
  truck?: boolean;
  className?: string;
  label?: string;
}) {
  const glass = { fill: 'var(--surface-0)', opacity: 0.7 };
  return (
    <svg
      viewBox="0 0 64 128"
      className={props.className}
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
    >
      {/* Wheels first, so the body sits over their inner edge. */}
      {(Object.keys(WHEEL_AT) as WheelKey[]).map((w) => (
        <rect
          key={w}
          x={WHEEL_AT[w][0]}
          y={WHEEL_AT[w][1]}
          width="8"
          height="24"
          rx="3"
          fill={props.attention?.has(w) ? 'var(--status-warning)' : 'var(--surface-3)'}
        />
      ))}
      <rect
        x="10"
        y="4"
        width="44"
        height="120"
        rx="18"
        fill="var(--surface-2)"
        stroke="var(--border)"
        vectorEffect="non-scaling-stroke"
      />
      <path d="M16 38 Q32 30 48 38 L46 52 Q32 47 18 52 Z" {...glass} />
      {props.truck ? (
        <>
          <path d={CAB_GLASS} {...glass} />
          <path d={BED} fill="none" stroke="var(--border)" vectorEffect="non-scaling-stroke" />
        </>
      ) : (
        <path d={REAR_GLASS} {...glass} />
      )}
      {props.open &&
        Object.entries(PARTS)
          .filter(([key]) => props.open!.has(key))
          .map(([key, d]) => (
            <path
              key={key}
              d={d}
              fill={OPEN_FILL}
              stroke={OPEN_STROKE}
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
            />
          ))}
    </svg>
  );
}
