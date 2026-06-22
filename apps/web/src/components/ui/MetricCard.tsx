import type { ReactNode } from "react";

interface MetricCardProps {
  label: string;
  value: ReactNode;
  detail: ReactNode;
}

export function MetricCard({ label, value, detail }: MetricCardProps) {
  return (
    <article className="metricCard">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
