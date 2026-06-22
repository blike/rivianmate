import type { ChargingSessionDetail } from "../../types/index.js";

interface ChargingCurveChartProps {
  samples: ChargingSessionDetail["samples"];
}

export function ChargingCurveChart({ samples }: ChargingCurveChartProps) {
  const powerSamples = samples.filter((s) => s.powerKw != null);
  if (powerSamples.length < 2) {
    return (
      <div className="chartEmpty">
        <strong>Not enough data</strong>
        <span>Charging curve requires multiple power samples.</span>
      </div>
    );
  }

  const width = 640;
  const height = 190;
  const padding = { bottom: 28, left: 44, right: 16, top: 16 };
  const firstTime = new Date(powerSamples[0]!.observedAt).getTime();
  const lastTime = new Date(powerSamples[powerSamples.length - 1]!.observedAt).getTime();
  const timeSpan = Math.max(1, lastTime - firstTime);
  const maxPower = Math.max(1, ...powerSamples.map((s) => s.powerKw!));
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const path = powerSamples
    .map((s, i) => {
      const x =
        padding.left +
        ((new Date(s.observedAt).getTime() - firstTime) / timeSpan) * chartWidth;
      const y = padding.top + (1 - s.powerKw! / maxPower) * chartHeight;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="chartBox">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Charging power curve"
      >
        <line
          className="chartAxis"
          x1={padding.left}
          x2={width - padding.right}
          y1={height - padding.bottom}
          y2={height - padding.bottom}
        />
        <line
          className="chartAxis"
          x1={padding.left}
          x2={padding.left}
          y1={padding.top}
          y2={height - padding.bottom}
        />
        <text
          className="chartLabel"
          x={padding.left - 4}
          y={padding.top + 4}
          textAnchor="end"
        >
          {maxPower.toFixed(0)} kW
        </text>
        <text
          className="chartLabel"
          x={padding.left - 4}
          y={height - padding.bottom}
          textAnchor="end"
        >
          0
        </text>
        <path className="chargingLine" d={path} />
      </svg>
    </div>
  );
}
