import type { SnapshotHistoryPoint } from "../../types/index.js";
import type { UnitPrefs } from "../../types/index.js";
import { formatPercent } from "../../utils/formatters.js";

interface HistoryChartProps {
  points: SnapshotHistoryPoint[];
  unitPrefs: UnitPrefs;
}

const WIDTH = 640;
const HEIGHT = 190;
const PADDING = { bottom: 28, left: 36, right: 16, top: 16 };

export function HistoryChart({ points, unitPrefs }: HistoryChartProps) {
  const batteryPoints = points.filter((p) => p.batteryLevel != null);

  if (batteryPoints.length < 2) {
    return (
      <div className="chartEmpty">
        <strong>
          {batteryPoints.length === 1
            ? formatPercent(batteryPoints[0]?.batteryLevel)
            : "No history yet"}
        </strong>
        <span>Battery and range trends will draw after more vehicle-state samples arrive.</span>
      </div>
    );
  }

  const firstTime = new Date(batteryPoints[0]!.observedAt).getTime();
  const lastTime = new Date(batteryPoints[batteryPoints.length - 1]!.observedAt).getTime();
  const timeSpan = Math.max(1, lastTime - firstTime);

  const batteryPath = buildLinePath(batteryPoints, firstTime, timeSpan, (p) => p.batteryLevel, 0, 100);

  const rangeValues = points.map((p) => p.estimatedRangeKm).filter((v): v is number => v != null);
  const maxRange = Math.max(1, ...rangeValues);
  const rangePath = buildLinePath(
    points.filter((p) => p.estimatedRangeKm != null),
    firstTime,
    timeSpan,
    (p) => p.estimatedRangeKm,
    0,
    maxRange
  );

  const trendPath = buildTrendLine(batteryPoints, firstTime, timeSpan);
  const rangeLabel = unitPrefs.distance === "km" ? "Range (km)" : "Range (mi)";

  return (
    <div className="chartBox">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Battery and range history"
      >
        <line
          className="chartAxis"
          x1={PADDING.left}
          x2={WIDTH - PADDING.right}
          y1={HEIGHT - PADDING.bottom}
          y2={HEIGHT - PADDING.bottom}
        />
        <line
          className="chartAxis"
          x1={PADDING.left}
          x2={PADDING.left}
          y1={PADDING.top}
          y2={HEIGHT - PADDING.bottom}
        />
        {[0, 25, 50, 75, 100].map((pct) => {
          const y =
            PADDING.top + (1 - pct / 100) * (HEIGHT - PADDING.top - PADDING.bottom);
          return (
            <g key={pct}>
              <line
                className="chartGrid"
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={y}
                y2={y}
              />
              <text
                className="chartLabel"
                x={PADDING.left - 4}
                y={y + 4}
                textAnchor="end"
              >
                {pct}%
              </text>
            </g>
          );
        })}
        <path className="rangeLine" d={rangePath} />
        <path className="batteryLine" d={batteryPath} />
        <path className="trendLine" d={trendPath} />
      </svg>
      <div className="chartLegend">
        <span>
          <i className="batteryKey" /> Battery %
        </span>
        <span>
          <i className="rangeKey" /> {rangeLabel}
        </span>
        <span>
          <i className="trendKey" /> Trend
        </span>
      </div>
    </div>
  );
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

function toXY(
  observedAt: string,
  value: number,
  firstTime: number,
  timeSpan: number,
  minValue: number,
  maxValue: number
) {
  const chartW = WIDTH - PADDING.left - PADDING.right;
  const chartH = HEIGHT - PADDING.top - PADDING.bottom;
  const x = PADDING.left + ((new Date(observedAt).getTime() - firstTime) / timeSpan) * chartW;
  const y =
    PADDING.top + (1 - (value - minValue) / Math.max(1, maxValue - minValue)) * chartH;
  return { x, y };
}

function buildLinePath(
  points: SnapshotHistoryPoint[],
  firstTime: number,
  timeSpan: number,
  getValue: (p: SnapshotHistoryPoint) => number | null,
  minValue: number,
  maxValue: number
): string {
  return points
    .map((point, i) => {
      const value = getValue(point) ?? minValue;
      const { x, y } = toXY(point.observedAt, value, firstTime, timeSpan, minValue, maxValue);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function buildTrendLine(
  points: SnapshotHistoryPoint[],
  firstTime: number,
  timeSpan: number
): string {
  if (points.length < 2) return "";

  const xs = points.map((p) => (new Date(p.observedAt).getTime() - firstTime) / timeSpan);
  const ys = points.map((p) => p.batteryLevel ?? 0);
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i]!, 0);
  const sumX2 = xs.reduce((a, x) => a + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return "";

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const chartW = WIDTH - PADDING.left - PADDING.right;
  const chartH = HEIGHT - PADDING.top - PADDING.bottom;

  const x0 = PADDING.left;
  const y0 = PADDING.top + (1 - intercept / 100) * chartH;
  const x1 = PADDING.left + chartW;
  const y1 = PADDING.top + (1 - (slope + intercept) / 100) * chartH;

  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}
