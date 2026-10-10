import { preconditioningLabel } from "../lib/vehicleStatus.js";
import type { ReactNode } from "react";
import type { VehicleState } from "@server/api-types.js";
import { nv, sv, titleCase } from "../lib/state.js";
import { useUnits } from "../api/hooks.js";
import { type ClosureStatus, closurePlaceholders, closureStatuses } from "../lib/closures.js";
import { Skeleton, useLoading } from "./loading.js";

export function StatCard(props: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  const loading = useLoading();
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
        {props.label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {loading ? <Skeleton /> : props.value}
      </div>
      {props.sub && (
        <div className="mt-1 text-xs text-[var(--text-secondary)]">
          {loading ? <Skeleton className="w-[8em]" /> : props.sub}
        </div>
      )}
    </div>
  );
}

export function Panel(props: { title: string; className?: string; action?: ReactNode; children: ReactNode }) {
  const heading = <h3 className="text-sm font-medium text-[var(--text-secondary)]">{props.title}</h3>;
  return (
    <section className={`card p-4 ${props.className ?? ""}`}>
      {props.action ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {heading}
          {props.action}
        </div>
      ) : (
        <div className="mb-3">{heading}</div>
      )}
      {props.children}
    </section>
  );
}

function StatusDot(props: { ok: boolean | null }) {
  const color =
    props.ok == null
      ? "var(--text-muted)"
      : props.ok
        ? "var(--status-good)"
        : "var(--status-warning)";
  return (
    <span
      className="inline-block h-2 w-2 rounded-full"
      style={{ background: color }}
    />
  );
}

function ClosureRow(props: { status: ClosureStatus }) {
  // Lock state isn't shown per part: it's the same for all of them, and
  // the dashboard's Locked/Unlocked chip already covers it.
  const { label, closed } = props.status;
  const loading = useLoading();
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className="flex items-center gap-2">
        {loading ? (
          <Skeleton className="w-[4em]" />
        ) : (
          <>
            <StatusDot ok={closed} />
            <span>{closed ? "Closed" : "Open"}</span>
          </>
        )}
      </span>
    </div>
  );
}

export function ClosuresGrid(props: {
  state: VehicleState | undefined;
  model?: string | null;
}) {
  const loading = useLoading();
  const { closures, windows } = loading
    ? closurePlaceholders(props.model)
    : closureStatuses(props.state, props.model);
  return (
    <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
      <div>
        {closures.map((c) => (
          <ClosureRow key={c.key} status={c} />
        ))}
      </div>
      <div>
        {windows.map((w) => (
          <ClosureRow key={w.key} status={w} />
        ))}
      </div>
    </div>
  );
}

export function ClimatePanel(props: { state: VehicleState | undefined }) {
  const s = props.state;
  const u = useUnits();
  const interior = nv(s, "cabinClimateInteriorTemperature");
  return (
    <dl className="space-y-1 text-sm">
      <Row label="Cabin temperature" value={u.formatTemperature(interior)} />
      <Row label="Set temperature" value={u.formatTemperature(nv(s, "cabinClimateDriverTemperature"))} />
      <Row label="Preconditioning" value={preconditioningLabel(s)} />
      <Row label="Defrost" value={titleCase(sv(s, "defrostDefogStatus"))} />
      <Row label="Pet mode" value={titleCase(sv(s, "petModeStatus"))} />
    </dl>
  );
}


export function TirePanel(props: { state: VehicleState | undefined }) {
  const s = props.state;
  const u = useUnits();
  const loading = useLoading();
  const corners = [
    { label: "Front left", status: "tirePressureStatusFrontLeft", pressure: "tirePressureFrontLeft" },
    { label: "Front right", status: "tirePressureStatusFrontRight", pressure: "tirePressureFrontRight" },
    { label: "Rear left", status: "tirePressureStatusRearLeft", pressure: "tirePressureRearLeft" },
    { label: "Rear right", status: "tirePressureStatusRearRight", pressure: "tirePressureRearRight" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {corners.map((c) => {
        const status = sv(s, c.status);
        const bar = nv(s, c.pressure);
        return (
          <div key={c.label} className="rounded-md bg-[var(--surface-2)] p-3 text-sm">
            <div className="text-xs text-[var(--text-muted)]">{c.label}</div>
            <div className="mt-1 flex items-center gap-2">
              {loading ? (
                <Skeleton />
              ) : (
                <>
                  <StatusDot ok={status == null ? null : status === "OK"} />
                  <span className="tabular-nums">
                    {bar != null ? u.formatPressure(bar) : (status ?? "—")}
                  </span>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Row(props: { label: string; value: ReactNode }) {
  const loading = useLoading();
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-[var(--text-secondary)]">{props.label}</dt>
      <dd className="tabular-nums">{loading ? <Skeleton className="w-[5em]" /> : props.value}</dd>
    </div>
  );
}
