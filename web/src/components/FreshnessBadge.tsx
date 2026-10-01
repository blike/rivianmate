import { useEffect, useState } from "react";
import type { VehicleState } from "@server/api-types.js";
import { type FreshnessLevel, freshness } from "../lib/freshness.js";
import { Skeleton, useLoading } from "./loading.js";

const DOT: Record<FreshnessLevel, string> = {
  live: "var(--status-good)",
  recent: "var(--text-muted)",
  asleep: "var(--text-muted)",
  stale: "var(--status-warning)",
};

/** "Online · updated 2 min ago": keeps stale data from looking live. */
export function FreshnessBadge(props: { state: VehicleState | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const loading = useLoading();
  const f = freshness(props.state, now);
  if (loading) {
    return (
      <span className="inline-flex items-center rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs">
        <Skeleton className="w-[12em]" />
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs text-[var(--text-secondary)]"
      title={f.lastSeen ? f.lastSeen.toLocaleString() : undefined}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: DOT[f.level] }} />
      {f.label}
    </span>
  );
}
