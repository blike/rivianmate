# Conditional Parallax GNSS Integration — Design Spec

## Implemented review corrections

The implementation supersedes the original proposal below in these areas:

- The existing battery/charging/trip Parallax subscription remains unconditional.
  GPS and tires use a separate, capability-gated dynamics subscription.
- GPS speed stays in m/s in `VehicleState`; consumers convert it for display
  and persistence. Parallax timestamps accept both seconds and milliseconds.
- GPS and tire fields from either stream merge by timestamp. Older readings
  cannot replace newer ones, and legacy data remains usable when dynamics
  is rejected, silent, or has not reported a particular field.
- Diagnostics expose a mode per vehicle for Settings badges. The overall
  mode reports Parallax when any monitored vehicle supports it.
- Mock dynamics GPS reports at startup, during driving, and at phase changes,
  including zero speed when the vehicle stops.


**Goal:** On top of upstream's existing (always-on, reactive) Parallax
integration, add a proactive per-vehicle capability check
(`VEHICLE_CONNECTIVITY_PARALLAX` in `supportedFeatures`) that gates *all*
Parallax subscription attempts, and add a new GNSS topic (gated the same
way) whose decoded data feeds the shared `VehicleState` cache — restoring
live location/heading/speed for vehicles whose legacy `gnssLocation` query
has started failing GraphQL validation. Surface the mode (`classic` vs
`parallax`) and new counters in the existing diagnostics panel and a
read-only badge in Settings.

**Why:** See `github.com/blike/rivianmate` issue #14. On a real 2027 R2,
`gnssLocation`/`activeDriverName` fail GraphQL validation outright, and
several other legacy fields never arrive via subscription, even though
upstream's existing Parallax work (PR #4) already restores battery/charging/
trip data for Parallax-capable vehicles. GPS location is the one gap left,
and it's load-bearing: `DriveDetector`'s `isMoving` check, the location
trail (`location_points`), and the dashboard map all depend on it.

## Current state (upstream `main`, confirmed by reading the code)

- `RivianSubscriptionManager.subscribeParallax(vehicleId, rvms, callback)`
  is always called unconditionally in `VehicleMonitor.start()` with
  `PARALLAX_MONITOR_RVMS` (battery state, cold-weather SoC, parked energy,
  network, trip info/progress). Rejection is detected *reactively* via
  `isUnsupported(kind)`, not checked in advance.
- Parallax-decoded data is fully siloed: it reaches `ParallaxStore`
  (→ `VehicleInsightsDto`/`/insights`) and `ChargingMonitor.ingestParallax`
  only. It never touches `VehicleState`/`mergeVehicleState`/`handleDelta` —
  the cache the map, location trail, and `DriveDetector` all read from.
- `gnssLocation` is still in `CORE_VEHICLE_STATE_PROPERTIES`. The
  subscription manager already has a generic auto-drop mechanism
  (`rejectedFields()` / `disabledFields` / a `droppedFields` getter "for
  diagnostics") that strips a field after Rivian rejects it with
  `Cannot query field "X"` — this is *why* the rest of the legacy
  subscription keeps working despite `gnssLocation` being invalid. The
  getter exists but isn't currently surfaced through the diagnostics API.
- `vehicles.supportedFeatures` (jsonb) is already populated at connect time
  from `getUserInfo()` and used elsewhere (R1S/R2 closure model-awareness).
- `mergeVehicleState(cached, delta)` is a simple last-write-wins merge, no
  timestamp precedence (never needed one — only one source has ever written
  to this cache). Kept as-is; see Risks.

## Changes

### 1. Capability detection (`server/src/rivian/parallax.ts`)
```ts
export const PARALLAX_FEATURE_FLAG = "VEHICLE_CONNECTIVITY_PARALLAX";
export function vehicleSupportsParallax(
  supportedFeatures: readonly string[] | null | undefined,
): boolean {
  return (supportedFeatures ?? []).includes(PARALLAX_FEATURE_FLAG);
}
```
Pure, unit tested directly.

### 2. GNSS decoder (`server/src/rivian/parallax.ts`)
New topic constant `RVM_GNSS = "dynamics.vehicle.gnss"` and a decoder built
on their existing `readProtoFields`/field-accessor style (BigInt wire
values), not our array-based one from the standalone fork. Same field
mapping as before (ported, not reinvented):
- field 1/2 (wire 1, double) → latitude/longitude → `gnssLocation`
- field 3 (wire 1, double) → `gnssAltitude`
- field 5 (wire 5, float) → signed -180..180 heading → normalized 0-360 →
  `gnssBearing`
- field 6 (wire 5, float) → speed in m/s → ×3.6 → `gnssSpeed` (km/h, matching
  their existing convention — see their own `85ff758` unit-bug fix)

Returns a `VehicleState`-shaped partial (`{ gnssLocation?, gnssAltitude?,
gnssBearing?, gnssSpeed? }` each wrapped `{ timeStamp, value }` except the
compound `gnssLocation`), same envelope `mergeVehicleState` already expects.

### 3. Subscription wiring (`server/src/services/vehicle-monitor.ts`)
- Gate the existing `stream.subscribeParallax?.(vehicle.id, PARALLAX_MONITOR_RVMS, ...)`
  call on `vehicleSupportsParallax(vehicle.supportedFeatures)`. When the
  vehicle doesn't support Parallax, skip the subscription entirely (no
  change in behavior for non-Parallax vehicles beyond no longer attempting
  it — their reactive `isUnsupported` path becomes unreachable for them,
  which is fine, it was always going to report "unsupported" anyway).
- When gated open, also subscribe `RVM_GNSS` (combine into one rvms list
  passed to `subscribeParallax`, or a second call — whichever matches how
  `subscribeParallax`'s one-subscription-per-vehicle id is keyed; confirm
  against `subscription.ts` during implementation).
- Route only the GNSS topic's decoded payload through
  `this.handleDelta(vehicleId, decoded)` (reuses the untouched
  `mergeVehicleState` + snapshot-write + drive-detection + charging-location
  pipeline). All other Parallax topics keep their existing
  `ingestParallax`/`parallaxStore.ingest` routing, unchanged.
- Store the capability result (`supportsParallax: boolean`) somewhere
  `diagnostics()` can read it (a field on `VehicleMonitor`, set once at
  `start()`).

### 4. Diagnostics (`server/src/api-types.ts`, `server/src/routes/rivian.ts`, `server/src/services/vehicle-monitor.ts`, `server/src/rivian/subscription.ts`)
- `MonitorDiagnostics` gains `parallaxMode: "classic" | "parallax"` and
  `parallaxDroppedFields: string[]` (surfacing the existing
  `droppedFields` getter — new, not previously exposed via the API).
- Governor-style 24h counters for the new GNSS topic specifically
  (messages received), added next to the existing traffic snapshot fields
  the same way other per-operation counters already work — exact
  mechanism TBD against `governor.ts`'s existing counter plumbing during
  implementation (may piggyback on `wsMessages`/`requestsByOperation24h`
  rather than inventing a parallel counter system).

### 5. UI (`web/src/pages/Settings.tsx`, `web/src/api/client.ts` types)
- Vehicle panel: a read-only badge next to the VIN, `Classic` or
  `w/ Parallax`, sourced from `diagnostics.monitor.parallaxMode`.
- Diagnostics panel: when `parallaxMode === "parallax"`, an additional row
  for the new GNSS message count; always show `parallaxDroppedFields` when
  non-empty (concrete evidence of *why* a vehicle needs Parallax).

### 6. Mock mode (`server/src/rivian/mock.ts`)
Add a second profile (or an env-driven flag) whose `supportedFeatures`
includes `VEHICLE_CONNECTIVITY_PARALLAX` and which emits a
`dynamics.vehicle.gnss` Parallax message, so the conditional path is
exercisable without a real Parallax-flagged account.

## Testing

- `vehicleSupportsParallax`: unit tests (present/absent/empty/undefined).
- GNSS decoder: unit tests against their `readProtoFields`/encode-test-helper
  style (port the bearing/speed/altitude cases from the standalone fork's
  `parallax.test.ts`, adapted to their protobuf helper API).
- `VehicleMonitor`: whatever test coverage already exists for subscription
  wiring (check `vehicle-monitor.ts`'s existing test file, if any, before
  deciding whether this needs new DB-touching tests or follows the
  codebase's existing untested-service-layer convention).
- Manual/live verification: deploy against the real R2 account (which has
  the flag) and confirm `gnssLocation`/`gnssBearing`/`gnssSpeed` populate,
  the map/location trail update, and the Settings badge reads
  "w/ Parallax". A classic-mode vehicle isn't available to test live, so
  mock mode's new profile is the coverage for that path.

## Risks / deferred

- No timestamp-precedence merge for the GNSS fields (matching upstream's
  existing single-writer assumption in `mergeVehicleState`). If Rivian ever
  stops auto-dropping `gnssLocation` from the legacy subscription and
  starts delivering a stale value again, it could clobber fresher
  Parallax data. Accepted as low-probability and consistent with not
  adding complexity upstream's own code doesn't have elsewhere.
- Exact mechanism for the new GNSS 24h counter is left open pending a closer
  read of `governor.ts` during implementation, rather than guessed here.
