import { drizzle } from "drizzle-orm/postgres-js";
import { and, asc, desc, eq, isNull } from "drizzle-orm";

import * as schema from "./schema.js";
import {
  chargingSamples,
  chargingSessions,
  dataQualityEvents,
  drives,
  positions,
  vehicleRawEvents,
  vehicleSnapshots,
  vehicleStates
} from "./schema.js";

type Db = ReturnType<typeof drizzle<typeof schema>>;

// ─── Parsers ─────────────────────────────────────────────────────────────────

export function parseVehicleSnapshot(raw: Record<string, unknown>) {
  const location = recordValue(raw.gnssLocation);
  return {
    altitudeMeters: numberValue(raw.gnssAltitude),
    batteryLevel: numberValue(raw.batteryLevel),
    bearing: numberValue(raw.gnssBearing),
    cabinTemperatureC: numberValue(raw.cabinClimateInteriorTemperature),
    chargeLimit: numberValue(raw.batteryLimit),
    chargeScheduleTime: parseChargeScheduleTime(raw.chargeSchedule),
    chargeScheduleType: parseChargeScheduleType(raw.chargeSchedule),
    chargingState: stringValue(raw.chargerState) ?? stringValue(raw.chargerStatus),
    driveMode: stringValue(raw.driveMode),
    estimatedRangeKm: numberValue(raw.distanceToEmpty),
    gearStatus: stringValue(raw.gearStatus),
    latitude: numberField(location, "latitude"),
    longitude: numberField(location, "longitude"),
    outsideTemperatureC: null as number | null,
    powerState: stringValue(raw.powerState),
    speedMps: numberValue(raw.gnssSpeed)
  };
}

function parseChargeScheduleTime(value: unknown) {
  const schedule = recordValue(value);
  if (!schedule) return null;
  const startTime = schedule.startTime;
  // startTime is minutes since midnight (e.g. 1320 = 22:00)
  if (typeof startTime === "number") {
    const hours = Math.floor(startTime / 60);
    const mins = startTime % 60;
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  }
  if (typeof startTime === "string") return startTime;
  return null;
}

function parseChargeScheduleType(value: unknown) {
  const schedule = recordValue(value);
  if (!schedule) return null;
  return typeof schedule.type === "string" ? schedule.type : null;
}

export function parseChargingSessionData(raw: Record<string, unknown>) {
  const state = stringRecordValue(raw.vehicleChargerState);
  return {
    cost: numberField(raw, "currentPrice"),
    currency: stringField(raw, "currentCurrency"),
    pluggedIn: isPluggedIn(state),
    powerKw: numberRecordValue(raw.power),
    rangeAddedKm: numberRecordValue(raw.rangeAddedThisSession),
    soc: numberRecordValue(raw.soc),
    startTime: dateField(raw, "startTime"),
    state,
    totalChargedEnergyKwh: numberRecordValue(raw.totalChargedEnergy)
  };
}

// ─── State interval sync ──────────────────────────────────────────────────────

export async function syncVehicleStateInterval(
  db: Db,
  vehicleId: string,
  observedAt: Date,
  parsed: ReturnType<typeof parseVehicleSnapshot>
) {
  const currentState = parsed.powerState ?? "unknown";

  // Find the latest open state interval for this vehicle
  const openRows = await db
    .select()
    .from(vehicleStates)
    .where(and(eq(vehicleStates.vehicleId, vehicleId), isNull(vehicleStates.endedAt)))
    .orderBy(desc(vehicleStates.startedAt))
    .limit(1);
  const open = openRows[0] ?? null;

  if (!open) {
    // No open interval — create one
    await db.insert(vehicleStates).values({ state: currentState, startedAt: observedAt, vehicleId });
    return;
  }

  if (open.state === currentState) {
    // Same state — nothing to do
    return;
  }

  // State changed — close the current interval and open a new one
  await db
    .update(vehicleStates)
    .set({ endedAt: observedAt })
    .where(eq(vehicleStates.id, open.id));

  await db.insert(vehicleStates).values({ state: currentState, startedAt: observedAt, vehicleId });
}

// ─── Drive session sync ───────────────────────────────────────────────────────

export async function syncDriveSession(
  db: Db,
  vehicleId: string,
  observedAt: Date,
  parsed: ReturnType<typeof parseVehicleSnapshot>
): Promise<string | null> {
  const moving = isMoving(parsed);
  const openDrive = await getOpenDrive(db, vehicleId);

  if (!moving) {
    if (openDrive) {
      await db
        .update(drives)
        .set({
          endBatteryLevel: parsed.batteryLevel ?? openDrive.endBatteryLevel,
          endDate: observedAt,
          updatedAt: new Date()
        })
        .where(eq(drives.id, openDrive.id));
    }
    return null;
  }

  if (openDrive) {
    const incrementalDistanceKm =
      parsed.latitude != null && parsed.longitude != null
        ? distanceKm(openDrive.endLatitude, openDrive.endLongitude, parsed.latitude, parsed.longitude)
        : 0;
    await db
      .update(drives)
      .set({
        distanceKm: (openDrive.distanceKm ?? 0) + incrementalDistanceKm,
        durationSeconds: Math.max(
          0,
          Math.round((observedAt.getTime() - openDrive.startDate.getTime()) / 1000)
        ),
        endBatteryLevel: parsed.batteryLevel ?? openDrive.endBatteryLevel,
        endLatitude: parsed.latitude ?? openDrive.endLatitude,
        endLongitude: parsed.longitude ?? openDrive.endLongitude,
        updatedAt: new Date()
      })
      .where(eq(drives.id, openDrive.id));
    return openDrive.id;
  }

  const insertedRows = await db
    .insert(drives)
    .values({
      confidence: parsed.speedMps != null && parsed.speedMps > 1 ? "high" : "medium",
      distanceKm: 0,
      durationSeconds: 0,
      endBatteryLevel: parsed.batteryLevel,
      endLatitude: parsed.latitude,
      endLongitude: parsed.longitude,
      startBatteryLevel: parsed.batteryLevel,
      startDate: observedAt,
      startLatitude: parsed.latitude,
      startLongitude: parsed.longitude,
      vehicleId
    })
    .returning({ id: drives.id });
  return insertedRows[0]?.id ?? null;
}

// ─── Charging session sync ────────────────────────────────────────────────────

export async function syncChargingSession(
  db: Db,
  vehicleId: string,
  observedAt: Date,
  parsed: ReturnType<typeof parseVehicleSnapshot>
) {
  if (isPluggedIn(parsed.chargingState)) {
    const existingRows = await db
      .select()
      .from(chargingSessions)
      .where(and(eq(chargingSessions.vehicleId, vehicleId), isNull(chargingSessions.endDate)))
      .orderBy(desc(chargingSessions.startDate))
      .limit(1);
    const existing = existingRows[0];

    if (existing) {
      await db
        .update(chargingSessions)
        .set({ endBatteryLevel: parsed.batteryLevel ?? existing.endBatteryLevel, updatedAt: new Date() })
        .where(eq(chargingSessions.id, existing.id));
      return;
    }

    await db.insert(chargingSessions).values({
      confidence: "medium",
      endBatteryLevel: parsed.batteryLevel,
      startBatteryLevel: parsed.batteryLevel,
      startDate: observedAt,
      vehicleId
    });
    return;
  }

  await closeOpenChargingSession(db, vehicleId, observedAt, {
    currency: null,
    rangeAddedKm: null,
    soc: parsed.batteryLevel,
    totalChargedEnergyKwh: null
  });
}

export async function persistChargingData(
  db: Db,
  vehicleId: string,
  observedAt: Date,
  rawData: Record<string, unknown>
): Promise<{ hasSample: boolean; pluggedIn: boolean }> {
  const parsed = parseChargingSessionData(rawData);
  const hasSample =
    parsed.powerKw != null ||
    parsed.totalChargedEnergyKwh != null ||
    parsed.rangeAddedKm != null ||
    parsed.cost != null ||
    parsed.state != null;

  if (!hasSample) return { hasSample: false, pluggedIn: false };

  const chargingSessionId = parsed.pluggedIn
    ? await getOrCreateChargingSession(db, vehicleId, observedAt, parsed)
    : null;

  await db.insert(chargingSamples).values({
    chargingSessionId,
    cost: parsed.cost,
    currency: parsed.currency,
    observedAt,
    powerKw: parsed.powerKw,
    rangeAddedKm: parsed.rangeAddedKm,
    raw: rawData,
    totalChargedEnergyKwh: parsed.totalChargedEnergyKwh,
    vehicleId
  });

  if (!parsed.pluggedIn) {
    await closeOpenChargingSession(db, vehicleId, observedAt, parsed);
  }

  return { hasSample: true, pluggedIn: parsed.pluggedIn };
}

// ─── Main event processor ─────────────────────────────────────────────────────

export async function persistVehicleStateEvent(
  db: Db,
  vehicleId: string,
  observedAt: Date,
  raw: Record<string, unknown>,
  dedupeHash: string
): Promise<boolean> {
  const insertedRawEvents = await db
    .insert(vehicleRawEvents)
    .values({
      dedupeHash,
      parserVersion: "vehicle-state-v1",
      payload: raw,
      source: "rivian_vehicle_state_subscription",
      vehicleId
    })
    .onConflictDoNothing()
    .returning({ id: vehicleRawEvents.id });

  const rawEventId = insertedRawEvents[0]?.id;
  if (!rawEventId) return false; // duplicate

  const parsed = parseVehicleSnapshot(raw);
  const { gearStatus: _gearStatus, ...snapshotValues } = parsed;

  await db.insert(vehicleSnapshots).values({ ...snapshotValues, observedAt, raw, rawEventId, vehicleId });
  await syncVehicleStateInterval(db, vehicleId, observedAt, parsed);
  await syncChargingSession(db, vehicleId, observedAt, parsed);

  if (parsed.latitude != null && parsed.longitude != null) {
    const driveId = await syncDriveSession(db, vehicleId, observedAt, parsed);
    await db.insert(positions).values({
      altitudeMeters: parsed.altitudeMeters,
      batteryLevel: parsed.batteryLevel,
      bearing: parsed.bearing,
      driveId,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      observedAt,
      speedMps: parsed.speedMps,
      vehicleId
    });
  } else {
    await syncDriveSession(db, vehicleId, observedAt, parsed);
  }

  return true;
}

// ─── Replay ───────────────────────────────────────────────────────────────────

export async function replayVehicleEvents(db: Db, vehicleId: string) {
  // Clear all derived data for this vehicle
  await db.delete(positions).where(eq(positions.vehicleId, vehicleId));
  await db.delete(drives).where(eq(drives.vehicleId, vehicleId));
  await db.delete(chargingSessions).where(eq(chargingSessions.vehicleId, vehicleId));
  await db.delete(chargingSamples).where(eq(chargingSamples.vehicleId, vehicleId));
  await db.delete(vehicleStates).where(eq(vehicleStates.vehicleId, vehicleId));
  await db.delete(vehicleSnapshots).where(eq(vehicleSnapshots.vehicleId, vehicleId));

  // Fetch all raw events in chronological order
  const events = await db
    .select()
    .from(vehicleRawEvents)
    .where(eq(vehicleRawEvents.vehicleId, vehicleId))
    .orderBy(asc(vehicleRawEvents.receivedAt));

  // Re-process each event — clear dedupe hashes so re-insert works
  await db.delete(vehicleRawEvents).where(eq(vehicleRawEvents.vehicleId, vehicleId));

  let processed = 0;
  for (const event of events) {
    await persistVehicleStateEvent(
      db,
      vehicleId,
      event.receivedAt,
      event.payload as Record<string, unknown>,
      event.dedupeHash
    );
    processed++;
  }

  return { processed };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOpenDrive(db: Db, vehicleId: string) {
  const rows = await db
    .select()
    .from(drives)
    .where(and(eq(drives.vehicleId, vehicleId), isNull(drives.endDate)))
    .orderBy(desc(drives.startDate))
    .limit(1);
  return rows[0] ?? null;
}

async function getOrCreateChargingSession(
  db: Db,
  vehicleId: string,
  observedAt: Date,
  parsed: ReturnType<typeof parseChargingSessionData>
) {
  const existingRows = await db
    .select()
    .from(chargingSessions)
    .where(and(eq(chargingSessions.vehicleId, vehicleId), isNull(chargingSessions.endDate)))
    .orderBy(desc(chargingSessions.startDate))
    .limit(1);
  const existing = existingRows[0];

  if (existing) {
    await db
      .update(chargingSessions)
      .set({
        currency: parsed.currency ?? existing.currency,
        energyDeliveredKwh: parsed.totalChargedEnergyKwh ?? existing.energyDeliveredKwh,
        peakPowerKw:
          parsed.powerKw != null
            ? Math.max(parsed.powerKw, existing.peakPowerKw ?? parsed.powerKw)
            : existing.peakPowerKw,
        rangeAddedKm: parsed.rangeAddedKm ?? existing.rangeAddedKm,
        updatedAt: new Date()
      })
      .where(eq(chargingSessions.id, existing.id));
    return existing.id;
  }

  const insertedRows = await db
    .insert(chargingSessions)
    .values({
      currency: parsed.currency,
      energyDeliveredKwh: parsed.totalChargedEnergyKwh,
      peakPowerKw: parsed.powerKw,
      rangeAddedKm: parsed.rangeAddedKm,
      startBatteryLevel: parsed.soc,
      startDate: parsed.startTime ?? observedAt,
      vehicleId
    })
    .returning({ id: chargingSessions.id });
  return insertedRows[0]?.id ?? null;
}

async function closeOpenChargingSession(
  db: Db,
  vehicleId: string,
  observedAt: Date,
  parsed: { currency: string | null; rangeAddedKm: number | null; soc: number | null; totalChargedEnergyKwh: number | null }
) {
  const existingRows = await db
    .select()
    .from(chargingSessions)
    .where(and(eq(chargingSessions.vehicleId, vehicleId), isNull(chargingSessions.endDate)))
    .orderBy(desc(chargingSessions.startDate))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) return;

  await db
    .update(chargingSessions)
    .set({
      currency: parsed.currency ?? existing.currency,
      endBatteryLevel: parsed.soc ?? existing.endBatteryLevel,
      endDate: observedAt,
      energyDeliveredKwh: parsed.totalChargedEnergyKwh ?? existing.energyDeliveredKwh,
      rangeAddedKm: parsed.rangeAddedKm ?? existing.rangeAddedKm,
      updatedAt: new Date()
    })
    .where(eq(chargingSessions.id, existing.id));
}

export function isMoving(parsed: ReturnType<typeof parseVehicleSnapshot>) {
  if (parsed.speedMps != null && parsed.speedMps > 1) return true;
  const gearStatus = parsed.gearStatus?.toLowerCase();
  if (gearStatus && (gearStatus.includes("drive") || gearStatus.includes("reverse"))) return true;
  return parsed.powerState?.toLowerCase() === "go";
}

export function isPluggedIn(state: string | null | undefined) {
  if (!state) return false;
  return !state.toLowerCase().includes("not_connected");
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : null;
}

function numberValue(value: unknown) {
  if (!isRecord(value)) return null;
  return typeof value.value === "number" ? value.value : null;
}

function numberRecordValue(value: unknown) {
  return numberValue(value);
}

function stringValue(value: unknown) {
  if (!isRecord(value)) return null;
  return typeof value.value === "string" ? value.value : null;
}

function stringRecordValue(value: unknown) {
  return stringValue(value);
}

function numberField(value: Record<string, unknown> | null, field: string) {
  const fieldValue = value?.[field];
  return typeof fieldValue === "number" ? fieldValue : null;
}

function stringField(value: Record<string, unknown> | null, field: string) {
  const fieldValue = value?.[field];
  return typeof fieldValue === "string" ? fieldValue : null;
}

function dateField(value: Record<string, unknown> | null, field: string) {
  const fieldValue = value?.[field];
  if (typeof fieldValue !== "string") return null;
  const timestamp = Date.parse(fieldValue);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function distanceKm(
  fromLatitude: number | null,
  fromLongitude: number | null,
  toLatitude: number,
  toLongitude: number
) {
  if (fromLatitude == null || fromLongitude == null) return 0;
  const earthRadiusKm = 6371;
  const deltaLatitude = degreesToRadians(toLatitude - fromLatitude);
  const deltaLongitude = degreesToRadians(toLongitude - fromLongitude);
  const startLatitude = degreesToRadians(fromLatitude);
  const endLatitude = degreesToRadians(toLatitude);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
