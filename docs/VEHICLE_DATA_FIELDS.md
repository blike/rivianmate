# Fields in `vehicle_state_snapshots.data`

`vehicle_state_snapshots.data` (jsonb) stores the **full, unfiltered** vehicle
state object as received from the Rivian API (see `snapshot-writer.ts`:
`data: state`). A handful of the most-used fields also get pulled out into
their own typed columns (`battery_level`, `battery_limit`, `range_km`,
`mileage_m`, `power_state`, `charger_status`, `cabin_temp`) for convenience —
everything else only lives in this jsonb blob, and isn't documented anywhere
else in the codebase or README. This file is a reference for that blob,
compiled by inspecting a running `MOCK_RIVIAN=1` instance.

**Every field observed follows the same envelope:**

```json
{ "value": <the actual value>, "timeStamp": "2026-08-22T11:30:43.270Z" }
```

so reading any field is `data->'fieldName'->>'value'` (text) or
`(data->'fieldName'->>'value')::numeric` (if numeric).

⚠️ **Caveat:** all of this was compiled against the mock simulator
(`MOCK_RIVIAN=1`), not a real vehicle. Field *names* are almost certainly
accurate (they match the app's own frontend code, which expects doors/tires/
climate data to exist), but some values below (units especially) are
best-effort inference, not confirmed against a real account. Fields marked
"not sampled" showed up as keys but I never captured a concrete value for
them. If you're reading this with a real vehicle connected, corrections
welcome.

## Power / Drive

| Field | Shape | Notes |
|---|---|---|
| `powerState` | string | Also in dedicated column `power_state`. Observed: `go`, `standby`. |
| `driveMode` | string | Observed: `everyday`. |
| `gearStatus` | string | Observed: `drive`. Presumably also `park`, `reverse`, `neutral`. |
| `gearGuardLocked` | string | Observed: `locked`. |

## Battery / Range

| Field | Shape | Notes |
|---|---|---|
| `batteryLevel` | number, % | Also in dedicated column `battery_level`. |
| `batteryLimit` | number, % | Also in dedicated column `battery_limit`. |
| `batteryCapacity` | number, kWh | Observed: `135`. Pack spec capacity, not a live measurement. |
| `distanceToEmpty` | number | Same value as dedicated column `range_km`. |
| `twelveVoltBatteryHealth` | string | Observed: `OK`. |

## Charging

| Field | Shape | Notes |
|---|---|---|
| `chargerStatus` | string | Also in dedicated column `charger_status`. Observed: `chrgr_sts_connected_charging`, `chrgr_sts_not_connected`. |
| `chargerState` | string | Distinct from `chargerStatus` — connection/session state. Observed: `charging_active`, `not_charging`. |
| `chargePortState` | string | Observed: `closed`. |
| `timeToEndOfCharge` | number | Observed: `1.83`. Unit unconfirmed — RivianLogbook's independent field mapping (a separate reverse-engineering project) assumes minutes; the observed value is more consistent with hours given the session it was sampled from. **Verify before trusting the unit.** |

## Location / Motion

| Field | Shape | Notes |
|---|---|---|
| `gnssSpeed`, `gnssBearing`, `gnssAltitude` | number | Also captured per-point in the dedicated `location_points` table (`speed_kmh`, `bearing`, `altitude`), which is a better source for history — this snapshot-level copy is just the latest instant. |
| `gnssLocation` | not sampled | Presumably a lat/lon pair or nested object; `location_points.lat`/`lon` is the reliable source. |
| `vehicleMileage` | number, m | Also in dedicated column `mileage_m`. |

## Climate

| Field | Shape | Notes |
|---|---|---|
| `cabinClimateInteriorTemperature` | number | Also in dedicated column `cabin_temp`. |
| `cabinClimateDriverTemperature` | not sampled | Driver's set-point temperature, distinct from actual interior temp. |
| `cabinPreconditioningStatus` | not sampled | |
| `defrostDefogStatus` | not sampled | |

## Doors / Windows / Closures

All boolean-ish states observed as the strings `closed`/`open` and
`locked`/`unlocked` (not JSON booleans).

| Field | Notes |
|---|---|
| `doorFrontLeftClosed` / `doorFrontLeftLocked` | Observed: `closed` / `locked`. Same pattern for `doorFrontRight*`, `doorRearLeft*`, `doorRearRight*` (not individually sampled, but present as keys). |
| `windowFrontLeftClosed` | Observed: `closed`. Same pattern for `windowFrontRightClosed`, `windowRearLeftClosed`, `windowRearRightClosed`. |
| `closureFrunkClosed` / `closureFrunkLocked` | Not sampled. |
| `closureTailgateClosed` / `closureTailgateLocked` | Not sampled. |
| `closureTonneauClosed` / `closureTonneauLocked` | Not sampled. |
| `closureSideBinLeftClosed` / `closureSideBinLeftLocked` | Not sampled. |
| `closureSideBinRightClosed` / `closureSideBinRightLocked` | Not sampled. |

## Tires

| Field | Shape | Notes |
|---|---|---|
| `tirePressureFrontLeft` / `...FrontRight` / `...RearLeft` / `...RearRight` | number, **bar** | Observed: `3.2`. Convert to psi with `× 14.5038` if you want US units (the app's own frontend does this conversion too). |
| `tirePressureStatusFrontLeft` / `...FrontRight` / `...RearLeft` / `...RearRight` | string | Observed: `OK`. |

## Software (OTA)

| Field | Shape | Notes |
|---|---|---|
| `otaStatus` | string | Observed: `Idle`. |
| `otaCurrentVersion` | string | Observed: `2024.14.00`. |
| `otaAvailableVersion` | string | Observed: `2024.14.00` (same as current — no update pending in this sample). |
| `otaInstallProgress` | number, % | Observed: `0`. |

## Misc / Comfort

| Field | Shape | Notes |
|---|---|---|
| `brakeFluidLow` | string | Observed: `false`. |
| `wiperFluidState` | string | Observed: `normal`. |
| `alarmSoundStatus` | string | Observed: `false`. |
| `cloudConnection` | string | Observed empty/null in one sample — may only populate intermittently. |
| `serviceMode` | string | Observed: `off`. |
| `trailerStatus` | string | Observed: `not_connected`. |
| `petModeStatus` | string | Observed: `off`. |
| `carWashMode` | string | Observed: `off`. |
| `rearHitchStatus` | not sampled | |
| `seatFrontLeftHeat` / `seatFrontRightHeat` | not sampled | |
| `steeringWheelHeat` | not sampled | |

## Why this matters

None of the fields above have a dedicated database column — they're only
reachable via jsonb path queries against `vehicle_state_snapshots.data`. The
[Grafana Vehicle Health dashboard](../grafana/rivianmate-vehicle-health.json)
in this contribution surfaces all of them; see its panel queries for working
examples of extracting each one.
