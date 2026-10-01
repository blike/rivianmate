import type { VehicleDto } from "@server/api-types.js";
import { useLiveCharging, useUnits, useVehicleState } from "../api/hooks.js";
import {
  ClimatePanel,
  ClosuresGrid,
  OtaPanel,
  Panel,
  Row,
  StatCard,
  TirePanel,
} from "../components/panels.js";
import { FreshnessBadge } from "../components/FreshnessBadge.js";
import { VehicleMap } from "../components/VehicleMap.js";
import { fmt, location, nv, sv, titleCase } from "../lib/state.js";

export function Dashboard(props: { vehicleId: string; vehicle?: VehicleDto }) {
  const { data: state } = useVehicleState(props.vehicleId);
  const { data: liveSession } = useLiveCharging(props.vehicleId);
  const u = useUnits();

  const battery = nv(state, "batteryLevel");
  const rangeKm = nv(state, "distanceToEmpty");
  const mileageM = nv(state, "vehicleMileage");
  const mileageKm = mileageM != null ? mileageM / 1000 : null;
  const speedMps = nv(state, "gnssSpeed");
  const power = sv(state, "powerState");
  const charger = sv(state, "chargerStatus");
  const charging = charger === "chrgr_sts_connected_charging";
  const loc = location(state);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium">
          {props.vehicle?.name ?? props.vehicle?.model ?? "Vehicle"}
          {props.vehicle?.modelYear && (
            <span className="ml-2 text-sm text-[var(--text-muted)]">
              {props.vehicle.modelYear} {props.vehicle.model}
            </span>
          )}
        </h2>
        <FreshnessBadge state={state} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Battery"
          value={battery != null ? `${fmt(battery, 0)}%` : "—"}
          sub={`Limit ${fmt(nv(state, "batteryLimit"), 0)}%`}
        />
        <StatCard
          label="Range"
          value={u.formatDistance(rangeKm)}
        />
        <StatCard
          label="Odometer"
          value={u.formatDistance(mileageKm)}
        />
        <StatCard
          label={charging ? "Charging" : "State"}
          value={
            charging && liveSession?.power?.value != null
              ? `${fmt(Number(liveSession.power.value), 1)} kW`
              : titleCase(power)
          }
          sub={
            charging
              ? liveSession?.timeRemaining?.value != null
                ? `${fmt(Number(liveSession.timeRemaining.value) / 60, 0)} min left`
                : "Plugged in"
              : titleCase(sv(state, "gearStatus"))
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Location">
          {loc ? (
            <VehicleMap
              lat={loc.lat}
              lon={loc.lon}
              bearing={nv(state, "gnssBearing")}
            />
          ) : (
            <p className="text-sm text-[var(--text-muted)]">No location yet.</p>
          )}
          {loc && (
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              Updated {new Date(loc.ts).toLocaleString()} ·{" "}
              {u.formatSpeed(speedMps != null ? speedMps * 3.6 : null)}
            </p>
          )}
        </Panel>

        <Panel title="Doors, closures & windows">
          <ClosuresGrid state={state} model={props.vehicle?.model} />
        </Panel>

        <Panel title="Climate">
          <ClimatePanel state={state} />
        </Panel>

        <Panel title="Tires">
          <TirePanel state={state} />
        </Panel>

        <Panel title="Software">
          <OtaPanel state={state} />
        </Panel>

        <Panel title="Vehicle health">
          <dl className="space-y-1 text-sm">
            <Row label="12V battery" value={titleCase(sv(state, "twelveVoltBatteryHealth"))} />
            <Row label="Brake fluid" value={sv(state, "brakeFluidLow") === "false" ? "OK" : titleCase(sv(state, "brakeFluidLow"))} />
            <Row label="Wiper fluid" value={titleCase(sv(state, "wiperFluidState"))} />
            <Row label="Drive mode" value={titleCase(sv(state, "driveMode"))} />
            <Row label="Gear guard" value={titleCase(sv(state, "gearGuardLocked"))} />
            <Row label="Charge port" value={titleCase(sv(state, "chargePortState"))} />
          </dl>
        </Panel>
      </div>
    </div>
  );
}
