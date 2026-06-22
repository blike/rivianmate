/** Confidence level badge (high / medium / low) */
export function ConfidenceBadge({ value }: { value: "high" | "medium" | "low" }) {
  return (
    <span className={`confidenceBadge ${value}`}>
      {value.charAt(0).toUpperCase() + value.slice(1)}
    </span>
  );
}

/** Severity badge for data-quality events */
export function SeverityBadge({ value }: { value: string }) {
  return <span className={`severityBadge ${value}`}>{value}</span>;
}

/** "Active" indicator — highlighted when the interval is ongoing */
export function StateBadge({ state, active }: { state: string; active: boolean }) {
  return (
    <span className={`activeBadge ${active ? "active" : ""}`}>
      {state.charAt(0).toUpperCase() + state.slice(1)}
    </span>
  );
}

/** Tire-pressure status chip */
export function TireBadge({ status }: { status: string | null }) {
  if (!status) return <span className="tireBadge unknown">—</span>;
  const cls = status.toLowerCase() === "nominal" ? "ok" : "warn";
  return <span className={`tireBadge ${cls}`}>{status}</span>;
}

/** 12V battery / OTA status chip */
export function HealthBadge({ value, ok }: { value: string | null; ok: boolean }) {
  if (!value) return <span className="healthBadge unknown">—</span>;
  return <span className={`healthBadge ${ok ? "ok" : "warn"}`}>{value}</span>;
}
