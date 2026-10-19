import { useId, useState } from 'react';
import { CarPlan, type WheelKey } from './CarPlan';

const GLOW = 'var(--status-warning)';

/** A glow's extent as fractions of the body: `u` across from the left, `v` from nose to tail. */
interface Region {
  u: [number, number];
  v: [number, number];
}

/** The same region on the right side of the vehicle. */
const mirror = (r: Region): Region => ({ u: [1 - r.u[1], 1 - r.u[0]], v: r.v });

/**
 * Doors and gear tunnel hatches glow out past the body's edge, as they swing
 * out; windows glow just inside it.
 */
function sides(front: Region['v'], rear: Region['v']) {
  const door = (v: Region['v']): Region => ({ u: [-0.12, 0.1], v });
  const glass = (v: Region['v']): Region => ({ u: [0.04, 0.16], v: [v[0] + 0.02, v[1] - 0.02] });
  return {
    doorFrontLeftClosed: door(front),
    doorRearLeftClosed: door(rear),
    doorFrontRightClosed: mirror(door(front)),
    doorRearRightClosed: mirror(door(rear)),
    windowFrontLeftClosed: glass(front),
    windowRearLeftClosed: glass(rear),
    windowFrontRightClosed: mirror(glass(front)),
    windowRearRightClosed: mirror(glass(rear)),
  };
}

/** Measured from the R1S render; the R2 shares its proportions. */
const SUV: Record<string, Region> = {
  closureFrunkClosed: { u: [0.12, 0.88], v: [0.02, 0.22] },
  ...sides([0.33, 0.55], [0.55, 0.74]),
  closureLiftgateClosed: { u: [0.1, 0.9], v: [0.8, 1.03] },
  windowRearGlassClosed: { u: [0.2, 0.8], v: [0.79, 0.9] },
};

/** From the R1T's proportions: a shorter cab, the gear tunnel behind it, then the bed. */
const TRUCK: Record<string, Region> = {
  closureFrunkClosed: { u: [0.12, 0.88], v: [0.02, 0.2] },
  ...sides([0.3, 0.47], [0.47, 0.62]),
  closureSideBinLeftClosed: { u: [-0.12, 0.1], v: [0.63, 0.69] },
  closureSideBinRightClosed: mirror({ u: [-0.12, 0.1], v: [0.63, 0.69] }),
  closureTonneauClosed: { u: [0.1, 0.9], v: [0.7, 0.96] },
  closureTailgateClosed: { u: [0.1, 0.9], v: [0.95, 1.04] },
};

/** The tires sit under the body; their glow shows past its edge. */
function wheels(front: Region['v'], rear: Region['v']): Record<WheelKey, Region> {
  const left: Region['u'] = [-0.08, 0.06];
  return {
    fl: { u: left, v: front },
    rl: { u: left, v: rear },
    fr: mirror({ u: left, v: front }),
    rr: mirror({ u: left, v: rear }),
  };
}
const SUV_WHEELS = wheels([0.13, 0.25], [0.72, 0.84]);
const TRUCK_WHEELS = wheels([0.12, 0.23], [0.69, 0.8]);

/** The body within the image, as fractions of it; the R1S render's until measured. */
interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
const R1S_BOX: Box = { x0: 38 / 344, x1: 311 / 344, y0: 20 / 782, y1: 714 / 782 };

/**
 * Finds the body in a render from its alpha: nose to tail from the first and
 * last painted rows, and its sides from the row halfway down, clear of the mirrors.
 */
function measureBody(img: HTMLImageElement): Box | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx || !w || !h) return null;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);
  const painted = (x: number, y: number) => data[(y * w + x) * 4 + 3]! > 40;
  const rowPainted = (y: number) => {
    for (let x = 0; x < w; x++) if (painted(x, y)) return true;
    return false;
  };
  let y0 = 0;
  while (y0 < h && !rowPainted(y0)) y0++;
  let y1 = h - 1;
  while (y1 > y0 && !rowPainted(y1)) y1--;
  if (y1 <= y0) return null;
  const mid = Math.round((y0 + y1) / 2);
  let x0 = 0;
  while (x0 < w && !painted(x0, mid)) x0++;
  let x1 = w - 1;
  while (x1 > x0 && !painted(x1, mid)) x1--;
  return { x0: x0 / w, x1: x1 / w, y0: y0 / h, y1: y1 / h };
}

/**
 * Rivian's overhead render of the vehicle, nose up, with a glow over each
 * closure named in `open` and each tire named in `attention`. Falls back to
 * the drawn plan if the render doesn't load. Sized by `className`'s height.
 */
export function RenderPlan(props: {
  src: string;
  attention?: ReadonlySet<WheelKey>;
  open?: ReadonlySet<string>;
  truck?: boolean;
  className?: string;
  label?: string;
}) {
  const filterId = useId();
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<Box>(R1S_BOX);

  if (failed) {
    const { src: _src, ...plan } = props;
    return <CarPlan {...plan} />;
  }

  const regions = props.truck ? TRUCK : SUV;
  const wheelRegions = props.truck ? TRUCK_WHEELS : SUV_WHEELS;
  const glows: Region[] = [
    ...Object.entries(regions)
      .filter(([key]) => props.open?.has(key))
      .map(([, r]) => r),
    ...[...(props.attention ?? [])].map((w) => wheelRegions[w]),
  ];

  // Glows are drawn in the image's own pixels, so they scale with it.
  const w = size?.w ?? 344;
  const h = size?.h ?? 782;
  const bx = box.x0 * w;
  const bw = (box.x1 - box.x0) * w;
  const by = box.y0 * h;
  const bh = (box.y1 - box.y0) * h;
  const blur = bw * 0.06;

  return (
    <div
      className={`relative w-fit ${props.className ?? ''}`}
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
    >
      <img
        src={props.src}
        alt=""
        className="h-full w-auto"
        onError={() => setFailed(true)}
        onLoad={(e) => {
          const img = e.currentTarget;
          setSize({ w: img.naturalWidth, h: img.naturalHeight });
          const measured = measureBody(img);
          if (measured) setBox(measured);
        }}
      />
      {size && glows.length > 0 && (
        <svg
          aria-hidden
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        >
          <defs>
            <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={blur} />
            </filter>
          </defs>
          {glows.map((r, i) => {
            const x = bx + r.u[0] * bw;
            const y = by + r.v[0] * bh;
            const rw = (r.u[1] - r.u[0]) * bw;
            const rh = (r.v[1] - r.v[0]) * bh;
            const rx = Math.min(rw, rh) / 2;
            return (
              <g key={i} filter={`url(#${filterId})`}>
                {/* A wide halo, then a brighter core. */}
                <rect x={x} y={y} width={rw} height={rh} rx={rx} fill={GLOW} opacity={0.55} />
                <rect
                  x={x + rw * 0.2}
                  y={y + rh * 0.2}
                  width={rw * 0.6}
                  height={rh * 0.6}
                  rx={rx * 0.6}
                  fill={GLOW}
                  opacity={0.7}
                />
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
