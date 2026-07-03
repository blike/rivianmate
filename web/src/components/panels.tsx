import type { ReactNode } from "react";
import type { VehicleState } from "@server/api-types.js";
import { fmt, nv, sv, titleCase } from "../lib/state.js";

export function StatCard(props: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
        {props.label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{props.value}</div>
      {props.sub && (
        <div className="mt-1 text-xs text-[var(--text-secondary)]">{props.sub}</div>
      )}
    </div>
  );
}

export function Panel(props: { title: string; children: ReactNode }) {
  return (
    <section className="card p-4">
      <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
        {props.title}
      </h3>
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

function ClosureRow(props: {
  label: string;
  closed: string | null;
  locked?: string | null;
}) {
  const isClosed = props.closed == null ? null : props.closed === "closed";
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-[var(--text-secondary)]">{props.label}</span>
      <span className="flex items-center gap-2">
        <StatusDot ok={isClosed} />
        <span>
          {props.closed == null ? "—" : isClosed ? "Closed" : "Open"}
          {props.locked != null && ` · ${props.locked === "locked" ? "Locked" : "Unlocked"}`}
        </span>
      </span>
    </div>
  );
}

export function ClosuresGrid(props: { state: VehicleState | undefined }) {
  const s = props.state;
  const rows: { label: string; closedKey: string; lockedKey?: string }[] = [
    { label: "Driver door", closedKey: "doorFrontLeftClosed", lockedKey: "doorFrontLeftLocked" },
    { label: "Passenger door", closedKey: "doorFrontRightClosed", lockedKey: "doorFrontRightLocked" },
    { label: "Rear left door", closedKey: "doorRearLeftClosed", lockedKey: "doorRearLeftLocked" },
    { label: "Rear right door", closedKey: "doorRearRightClosed", lockedKey: "doorRearRightLocked" },
    { label: "Frunk", closedKey: "closureFrunkClosed", lockedKey: "closureFrunkLocked" },
    { label: "Tailgate", closedKey: "closureTailgateClosed", lockedKey: "closureTailgateLocked" },
    { label: "Liftgate", closedKey: "closureLiftgateClosed", lockedKey: "closureLiftgateLocked" },
    { label: "Tonneau", closedKey: "closureTonneauClosed", lockedKey: "closureTonneauLocked" },
    { label: "Gear tunnel L", closedKey: "closureSideBinLeftClosed", lockedKey: "closureSideBinLeftLocked" },
    { label: "Gear tunnel R", closedKey: "closureSideBinRightClosed", lockedKey: "closureSideBinRightLocked" },
  ];
  const windows: { label: string; key: string }[] = [
    { label: "Window FL", key: "windowFrontLeftClosed" },
    { label: "Window FR", key: "windowFrontRightClosed" },
    { label: "Window RL", key: "windowRearLeftClosed" },
    { label: "Window RR", key: "windowRearRightClosed" },
  ];
  return (
    <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
      <div>
        {rows
          .filter((r) => sv(s, r.closedKey) != null)
          .map((r) => (
            <ClosureRow
              key={r.closedKey}
              label={r.label}
              closed={sv(s, r.closedKey)}
              locked={r.lockedKey ? sv(s, r.lockedKey) : undefined}
            />
          ))}
      </div>
      <div>
        {windows
          .filter((w) => sv(s, w.key) != null)
          .map((w) => (
            <ClosureRow key={w.key} label={w.label} closed={sv(s, w.key)} />
          ))}
      </div>
    </div>
  );
}

export function ClimatePanel(props: { state: VehicleState | undefined }) {
  const s = props.state;
  const interior = nv(s, "cabinClimateInteriorTemperature");
  return (
    <dl className="space-y-1 text-sm">
      <Row label="Cabin temperature" value={interior != null ? `${fmt(interior, 1)} °C` : "—"} />
      <Row label="Set temperature" value={valTemp(nv(s, "cabinClimateDriverTemperature"))} />
      <Row label="Preconditioning" value={titleCase(sv(s, "cabinPreconditioningStatus"))} />
      <Row label="Defrost" value={titleCase(sv(s, "defrostDefogStatus"))} />
      <Row label="Pet mode" value={titleCase(sv(s, "petModeStatus"))} />
    </dl>
  );
}

function valTemp(v: number | null): string {
  return v != null ? `${fmt(v, 1)} °C` : "—";
}

export function TirePanel(props: { state: VehicleState | undefined }) {
  const s = props.state;
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
              <StatusDot ok={status == null ? null : status === "OK"} />
              <span className="tabular-nums">
                {bar != null ? `${fmt(bar * 14.5038, 0)} psi` : (status ?? "—")}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function OtaPanel(props: { state: VehicleState | undefined }) {
  const s = props.state;
  const current = sv(s, "otaCurrentVersion");
  const available = sv(s, "otaAvailableVersion");
  const status = sv(s, "otaStatus");
  const progress = nv(s, "otaInstallProgress");
  const updateAvailable =
    available != null && available !== "0.0.0" && available !== current;
  return (
    <dl className="space-y-1 text-sm">
      <Row label="Installed version" value={current ?? "—"} />
      {updateAvailable && <Row label="Available update" value={available} />}
      <Row label="Status" value={titleCase(status)} />
      {progress != null && progress > 0 && (
        <Row label="Install progress" value={`${fmt(progress)}%`} />
      )}
    </dl>
  );
}

export function Row(props: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-[var(--text-secondary)]">{props.label}</dt>
      <dd className="tabular-nums">{props.value}</dd>
    </div>
  );
}
