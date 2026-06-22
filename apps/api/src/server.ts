import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import {
  accounts,
  chargingSamples,
  chargingSessions,
  createDatabase,
  dataQualityEvents,
  drives,
  localAdminUsers,
  localSessions,
  migrateDatabase,
  positions,
  replayVehicleEvents,
  rivianAuthChallenges,
  rivianCredentials,
  vehicleRawEvents,
  vehicleSnapshots,
  vehicleStates,
  vehicles
} from "@rivianmate/db";
import { RivianApiClient, RivianApiError, type RivianTokens } from "@rivianmate/rivian-api";
import type {
  AuthSession,
  ChargingSessionDetail,
  ChargingSessionSummary,
  DataQualityEvent,
  DataQualitySummary,
  DriveDetail,
  DriveSummary,
  OverviewSnapshot,
  RivianAuthStartResult,
  RivianCredentialStatus,
  RivianVehicleDiscoveryResult,
  SnapshotHistoryPoint,
  SetupStatus,
  VehicleHealthSnapshot,
  VehicleStateInterval,
  VehicleSummary
} from "@rivianmate/shared";
import { and, count, desc, eq, gt, lt, asc } from "drizzle-orm";
import Fastify from "fastify";
import type { FastifyReply } from "fastify";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { loadConfig } from "./config.js";
import { decryptText, encryptText } from "./security/encryption.js";
import { hashPassword, verifyPassword } from "./security/password.js";
import {
  createSessionToken,
  hashSessionToken,
  sessionCookieName,
  sessionExpiresAt
} from "./security/session.js";

const config = loadConfig();
await migrateDatabase(config.DATABASE_URL);
const database = createDatabase(config.DATABASE_URL);
const rivianApi = new RivianApiClient();

const app = Fastify({
  logger: {
    level: config.NODE_ENV === "production" ? "info" : "debug"
  }
});

await app.register(cors, {
  credentials: true,
  origin: config.NODE_ENV === "production" ? false : config.WEB_ORIGIN
});

await app.register(cookie);

const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(32, "Username must be at most 32 characters.")
  .regex(/^[a-zA-Z0-9_-]+$/, "Username may only contain letters, numbers, underscores, and hyphens.");

const createAdminBodySchema = z.object({
  username: usernameSchema,
  password: z.string().min(12).max(256)
});

const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256)
});

const changeUsernameBodySchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newUsername: usernameSchema
});

const loginBodySchema = z.object({
  username: z.string().min(1).max(32),
  password: z.string().min(1).max(256)
});

const rivianAuthStartBodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256)
});

const rivianMfaBodySchema = z.object({
  challengeId: z.string().uuid(),
  otpCode: z.string().min(4).max(12)
});

app.get("/api/health", async () => {
  try {
    await database.client`select 1`;
    return {
      ok: true,
      database: "reachable",
      service: "rivianmate-api"
    };
  } catch (error) {
    app.log.error({ error }, "database health check failed");
    return {
      ok: false,
      database: "unreachable",
      service: "rivianmate-api"
    };
  }
});

app.get("/api/setup", async (): Promise<SetupStatus> => {
  return {
    adminConfigured: await isAdminConfigured()
  };
});

app.post("/api/setup/admin", async (request, reply): Promise<SetupStatus> => {
  if (await isAdminConfigured()) {
    return reply.code(409).send({
      adminConfigured: true,
      message: "Local admin is already configured."
    });
  }

  const parsed = createAdminBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      adminConfigured: false,
      message: parsed.error.issues[0]?.message ?? "Invalid username or password."
    });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await database.db.insert(localAdminUsers).values({
    username: parsed.data.username,
    passwordHash
  });

  const session = await createSessionForAdmin();
  setSessionCookie(reply, session.token, session.expiresAt);

  return {
    adminConfigured: true
  };
});

app.get("/api/auth/session", async (request): Promise<AuthSession> => {
  return getAuthSession(request.cookies[sessionCookieName]);
});

app.post("/api/auth/login", async (request, reply): Promise<AuthSession> => {
  const parsed = loginBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      authenticated: false,
      username: null,
      message: "Username and password are required."
    });
  }

  const admin = await getAdminUser();
  if (!admin) {
    return reply.code(409).send({
      authenticated: false,
      username: null,
      message: "Local admin is not configured."
    });
  }

  const usernameMatch = admin.username.toLowerCase() === parsed.data.username.toLowerCase();
  const passwordMatch = await verifyPassword(parsed.data.password, admin.passwordHash);
  if (!usernameMatch || !passwordMatch) {
    return reply.code(401).send({
      authenticated: false,
      username: null,
      message: "Invalid username or password."
    });
  }

  const session = await createSessionForAdmin(admin.id);
  setSessionCookie(reply, session.token, session.expiresAt);

  return {
    authenticated: true,
    username: admin.username
  };
});

app.post("/api/auth/logout", async (request, reply): Promise<AuthSession> => {
  const token = request.cookies[sessionCookieName];
  if (token) {
    await database.db.delete(localSessions).where(eq(localSessions.tokenHash, hashSessionToken(token)));
  }
  clearSessionCookie(reply);
  return {
    authenticated: false,
    username: null
  };
});

app.get("/api/rivian/credentials", async (request, reply): Promise<RivianCredentialStatus | FastifyReply> => {
  if (!(await requireAuth(request.cookies[sessionCookieName], reply))) {
    return reply;
  }

  const account = await getDefaultAccount();
  const rows = await database.db
    .select()
    .from(rivianCredentials)
    .where(eq(rivianCredentials.accountId, account.id))
    .limit(1);
  const credential = rows[0];

  return {
    configured: Boolean(
      credential?.encryptedAccessToken &&
        credential.encryptedRefreshToken &&
        credential.encryptedUserSessionToken
    ),
    email: account.email,
    mfaRequired: false,
    status: credential?.status ?? "not_configured"
  };
});

app.post("/api/rivian/auth/start", async (request, reply): Promise<RivianAuthStartResult | FastifyReply> => {
  if (!(await requireAuth(request.cookies[sessionCookieName], reply))) {
    return reply;
  }

  const parsed = rivianAuthStartBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      message: "Enter a valid Rivian email and password."
    });
  }

  try {
    await deleteExpiredRivianChallenges();
    const account = await getDefaultAccount(parsed.data.email);
    const result = await rivianApi.authenticate(parsed.data.email, parsed.data.password);

    if (result.mfaRequired) {
      if (!result.otpToken) {
        throw new RivianApiError("Rivian requested MFA but did not provide an OTP token.");
      }

      const challengeRows = await database.db
        .insert(rivianAuthChallenges)
        .values({
          accountId: account.id,
          appSessionToken: encryptText(result.appSessionToken, config.APP_SECRET),
          csrfToken: encryptText(result.csrfToken, config.APP_SECRET),
          email: parsed.data.email,
          expiresAt: new Date(Date.now() + 1000 * 60 * 10),
          otpToken: encryptText(result.otpToken, config.APP_SECRET)
        })
        .returning({ id: rivianAuthChallenges.id });

      return {
        challengeId: challengeRows[0]?.id,
        status: "mfa_required"
      };
    }

    if (!result.tokens) {
      throw new RivianApiError("Rivian login did not return credentials.");
    }

    await storeRivianTokens(account.id, parsed.data.email, result.tokens);
    const discoveredVehicles = await discoverAndStoreVehicles(account.id, result.tokens);
    return {
      discoveredVehicles,
      status: "authenticated"
    };
  } catch (error) {
    request.log.warn({ error }, "Rivian authentication start failed");
    return reply.code(error instanceof RivianApiError ? 502 : 500).send({
      message: error instanceof Error ? error.message : "Rivian authentication failed."
    });
  }
});

app.post("/api/rivian/auth/mfa", async (request, reply): Promise<RivianAuthStartResult | FastifyReply> => {
  if (!(await requireAuth(request.cookies[sessionCookieName], reply))) {
    return reply;
  }

  const parsed = rivianMfaBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      message: "Enter the Rivian MFA code."
    });
  }

  const challengeRows = await database.db
    .select()
    .from(rivianAuthChallenges)
    .where(
      and(
        eq(rivianAuthChallenges.id, parsed.data.challengeId),
        gt(rivianAuthChallenges.expiresAt, new Date())
      )
    )
    .limit(1);
  const challenge = challengeRows[0];
  if (!challenge) {
    return reply.code(404).send({
      message: "Rivian MFA challenge expired. Start sign-in again."
    });
  }

  try {
    const tokens = await rivianApi.completeMfa(
      challenge.email,
      parsed.data.otpCode,
      decryptText(challenge.otpToken, config.APP_SECRET),
      {
        appSessionToken: decryptText(challenge.appSessionToken, config.APP_SECRET),
        csrfToken: decryptText(challenge.csrfToken, config.APP_SECRET)
      }
    );

    await storeRivianTokens(challenge.accountId, challenge.email, tokens);
    const discoveredVehicles = await discoverAndStoreVehicles(challenge.accountId, tokens);
    await database.db
      .delete(rivianAuthChallenges)
      .where(eq(rivianAuthChallenges.id, challenge.id));

    return {
      discoveredVehicles,
      status: "authenticated"
    };
  } catch (error) {
    request.log.warn({ error }, "Rivian MFA completion failed");
    return reply.code(error instanceof RivianApiError ? 502 : 500).send({
      message: error instanceof Error ? error.message : "Rivian MFA failed."
    });
  }
});

app.post(
  "/api/rivian/vehicles/discover",
  async (request, reply): Promise<RivianVehicleDiscoveryResult | FastifyReply> => {
    if (!(await requireAuth(request.cookies[sessionCookieName], reply))) {
      return reply;
    }

    const account = await getDefaultAccount();
    const tokens = await getStoredRivianTokens(account.id);
    if (!tokens) {
      return reply.code(409).send({
        message: "Connect your Rivian account before discovering vehicles."
      });
    }

    try {
      await discoverAndStoreVehicles(account.id, tokens);
      const rows = await database.db
        .select()
        .from(vehicles)
        .where(eq(vehicles.accountId, account.id))
        .orderBy(desc(vehicles.lastSeenAt));
      return {
        vehicles: rows.map(toVehicleSummary)
      };
    } catch (error) {
      request.log.warn({ error }, "Rivian vehicle discovery failed");
      return reply.code(error instanceof RivianApiError ? 502 : 500).send({
        message: error instanceof Error ? error.message : "Rivian vehicle discovery failed."
      });
    }
  }
);

app.addHook("preHandler", async (request, reply) => {
  if (!request.url.startsWith("/api/") || isPublicApiPath(request.url)) {
    return;
  }

  if (!(await isAdminConfigured())) {
    return;
  }

  const session = await getAuthSession(request.cookies[sessionCookieName]);
  if (!session.authenticated) {
    return reply.code(401).send({
      message: "Authentication required."
    });
  }
});

app.get("/api/vehicles", async (): Promise<VehicleSummary[]> => {
  const rows = await database.db.select().from(vehicles).orderBy(desc(vehicles.lastSeenAt));
  return rows.map(toVehicleSummary);
});

app.get("/api/overview", async (): Promise<OverviewSnapshot> => {
  const rows = await database.db.select().from(vehicles).where(eq(vehicles.enabled, true)).limit(1);
  const vehicle = rows[0] ? toVehicleSummary(rows[0]) : null;
  const snapshot = rows[0] ? await getLatestVehicleSnapshot(rows[0].id) : null;

  return {
    vehicle,
    collectorStatus: await getCollectorStatus(),
    batteryLevel: snapshot?.batteryLevel ?? null,
    estimatedRangeKm: snapshot?.estimatedRangeKm ?? null,
    chargeLimit: snapshot?.chargeLimit ?? null,
    powerState: toPowerState(snapshot?.powerState),
    chargingState: snapshot?.chargingState ?? null,
    latitude: snapshot?.latitude ?? null,
    longitude: snapshot?.longitude ?? null,
    cabinTemperatureC: snapshot?.cabinTemperatureC ?? null,
    outsideTemperatureC: snapshot?.outsideTemperatureC ?? null,
    speedMps: snapshot?.speedMps ?? null,
    driveMode: snapshot?.driveMode ?? null,
    lastUpdatedAt: snapshot?.observedAt.toISOString() ?? vehicle?.lastSeenAt ?? null
  };
});

app.get("/api/drives", async (): Promise<DriveSummary[]> => {
  const rows = await database.db
    .select()
    .from(drives)
    .orderBy(desc(drives.startDate))
    .limit(50);
  return rows.map(toDriveSummary);
});

app.get("/api/charging-sessions", async (): Promise<ChargingSessionSummary[]> => {
  const rows = await database.db
    .select()
    .from(chargingSessions)
    .orderBy(desc(chargingSessions.startDate))
    .limit(25);
  return rows.map(toChargingSessionSummary);
});

app.get("/api/history/snapshots", async (): Promise<SnapshotHistoryPoint[]> => {
  const rows = await database.db
    .select({
      batteryLevel: vehicleSnapshots.batteryLevel,
      estimatedRangeKm: vehicleSnapshots.estimatedRangeKm,
      latitude: vehicleSnapshots.latitude,
      longitude: vehicleSnapshots.longitude,
      observedAt: vehicleSnapshots.observedAt,
      speedMps: vehicleSnapshots.speedMps
    })
    .from(vehicleSnapshots)
    .orderBy(desc(vehicleSnapshots.observedAt))
    .limit(200);

  return rows.reverse().map((row) => ({
    batteryLevel: row.batteryLevel,
    estimatedRangeKm: row.estimatedRangeKm,
    latitude: row.latitude,
    longitude: row.longitude,
    observedAt: row.observedAt.toISOString(),
    speedMps: row.speedMps
  }));
});

app.get("/api/data-quality", async (): Promise<DataQualitySummary> => {
  const lastChargingFetch = await latestDataQualityEvent("charging_fetch_success");
  const lastVehicleEventRows = await database.db
    .select({ receivedAt: vehicleRawEvents.receivedAt })
    .from(vehicleRawEvents)
    .orderBy(desc(vehicleRawEvents.receivedAt))
    .limit(1);
  const since = new Date(Date.now() - 1000 * 60 * 60 * 24);
  const [collectorStatus, rateLimitCount, parserErrorCount, rawEventCount] = await Promise.all([
    getCollectorStatus(),
    countDataQualityEvents("rate_limit", since),
    countDataQualityEvents("parser_error", since),
    countRawEvents(since)
  ]);

  return {
    collectorStatus,
    lastVehicleEventAt: lastVehicleEventRows[0]?.receivedAt.toISOString() ?? null,
    lastChargingFetchAt: lastChargingFetch?.observedAt.toISOString() ?? null,
    currentBackoffSeconds: null,
    rateLimitCount24h: rateLimitCount,
    parserErrorCount24h: parserErrorCount,
    rawEventCount24h: rawEventCount
  };
});

app.post("/api/auth/change-password", async (request, reply) => {
  const parsed = changePasswordBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "Current password and new password (12+ characters) are required." });
  }

  const admin = await getAdminUser();
  if (!admin) {
    return reply.code(409).send({ message: "Local admin is not configured." });
  }

  if (!(await verifyPassword(parsed.data.currentPassword, admin.passwordHash))) {
    return reply.code(401).send({ message: "Current password is incorrect." });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await database.db
    .update(localAdminUsers)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(localAdminUsers.id, admin.id));

  return { ok: true };
});

app.post("/api/auth/change-username", async (request, reply) => {
  const parsed = changeUsernameBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      message: parsed.error.issues[0]?.message ?? "Current password and a valid username are required."
    });
  }

  const admin = await getAdminUser();
  if (!admin) {
    return reply.code(409).send({ message: "Local admin is not configured." });
  }

  if (!(await verifyPassword(parsed.data.currentPassword, admin.passwordHash))) {
    return reply.code(401).send({ message: "Current password is incorrect." });
  }

  if (parsed.data.newUsername === admin.username) {
    return { ok: true, username: admin.username };
  }

  await database.db
    .update(localAdminUsers)
    .set({ username: parsed.data.newUsername, updatedAt: new Date() })
    .where(eq(localAdminUsers.id, admin.id));

  return { ok: true, username: parsed.data.newUsername };
});

app.get("/api/data-quality/events", async (): Promise<DataQualityEvent[]> => {
  const rows = await database.db
    .select()
    .from(dataQualityEvents)
    .where(gt(dataQualityEvents.observedAt, new Date(Date.now() - 1000 * 60 * 60 * 24)))
    .orderBy(desc(dataQualityEvents.observedAt))
    .limit(100);
  return rows.map((row) => ({
    id: row.id,
    vehicleId: row.vehicleId,
    category: row.category,
    severity: row.severity,
    message: row.message,
    observedAt: row.observedAt.toISOString()
  }));
});

app.get("/api/drives/:id", async (request, reply): Promise<DriveDetail | FastifyReply> => {
  const { id } = request.params as { id: string };
  const driveRows = await database.db.select().from(drives).where(eq(drives.id, id)).limit(1);
  const drive = driveRows[0];
  if (!drive) {
    return reply.code(404).send({ message: "Drive not found." });
  }

  const positionRows = await database.db
    .select()
    .from(positions)
    .where(eq(positions.driveId, id))
    .orderBy(asc(positions.observedAt));

  return {
    ...toDriveSummary(drive),
    startLatitude: drive.startLatitude,
    startLongitude: drive.startLongitude,
    endLatitude: drive.endLatitude,
    endLongitude: drive.endLongitude,
    positions: positionRows.map((p) => ({
      observedAt: p.observedAt.toISOString(),
      latitude: p.latitude,
      longitude: p.longitude,
      altitudeMeters: p.altitudeMeters,
      speedMps: p.speedMps,
      batteryLevel: p.batteryLevel
    }))
  };
});

app.get("/api/charging-sessions/:id", async (request, reply): Promise<ChargingSessionDetail | FastifyReply> => {
  const { id } = request.params as { id: string };
  const sessionRows = await database.db.select().from(chargingSessions).where(eq(chargingSessions.id, id)).limit(1);
  const session = sessionRows[0];
  if (!session) {
    return reply.code(404).send({ message: "Charging session not found." });
  }

  const sampleRows = await database.db
    .select()
    .from(chargingSamples)
    .where(eq(chargingSamples.chargingSessionId, id))
    .orderBy(asc(chargingSamples.observedAt));

  return {
    ...toChargingSessionSummary(session),
    startBatteryLevel: session.startBatteryLevel,
    endBatteryLevel: session.endBatteryLevel,
    peakPowerKw: session.peakPowerKw,
    samples: sampleRows.map((s) => ({
      observedAt: s.observedAt.toISOString(),
      powerKw: s.powerKw,
      totalChargedEnergyKwh: s.totalChargedEnergyKwh,
      rangeAddedKm: s.rangeAddedKm
    }))
  };
});

const vehicleEnabledBodySchema = z.object({ enabled: z.boolean() });

app.patch("/api/vehicles/:id/enabled", async (request, reply) => {
  const { id } = request.params as { id: string };
  const parsed = vehicleEnabledBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "enabled (boolean) is required." });
  }

  const updated = await database.db
    .update(vehicles)
    .set({ enabled: parsed.data.enabled })
    .where(eq(vehicles.id, id))
    .returning();

  if (!updated[0]) {
    return reply.code(404).send({ message: "Vehicle not found." });
  }
  return toVehicleSummary(updated[0]);
});

app.delete("/api/rivian/credentials", async () => {
  const account = await getDefaultAccount();
  await database.db.delete(rivianCredentials).where(eq(rivianCredentials.accountId, account.id));
  return { ok: true };
});

app.get("/api/vehicles/:id/states", async (request, reply): Promise<VehicleStateInterval[] | FastifyReply> => {
  const { id } = request.params as { id: string };
  const vehicleRows = await database.db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, id)).limit(1);
  if (!vehicleRows[0]) {
    return reply.code(404).send({ message: "Vehicle not found." });
  }

  const rows = await database.db
    .select()
    .from(vehicleStates)
    .where(eq(vehicleStates.vehicleId, id))
    .orderBy(desc(vehicleStates.startedAt))
    .limit(100);

  return rows.map((row) => ({
    id: row.id,
    vehicleId: row.vehicleId,
    state: row.state,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null
  }));
});

app.get("/api/vehicles/:id/health-snapshot", async (request, reply): Promise<VehicleHealthSnapshot | FastifyReply> => {
  const { id } = request.params as { id: string };
  const vehicleRows = await database.db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, id)).limit(1);
  if (!vehicleRows[0]) {
    return reply.code(404).send({ message: "Vehicle not found." });
  }

  const snapshot = await getLatestVehicleSnapshot(id);
  const raw = (snapshot?.raw ?? {}) as Record<string, { value?: unknown } | unknown>;

  function rawStr(key: string): string | null {
    const entry = (raw as Record<string, unknown>)[key];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const v = (entry as Record<string, unknown>).value;
      return typeof v === "string" ? v : null;
    }
    if (typeof entry === "string") return entry;
    return null;
  }

  function rawBool(key: string): boolean | null {
    const entry = (raw as Record<string, unknown>)[key];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const v = (entry as Record<string, unknown>).value;
      if (typeof v === "boolean") return v;
      if (typeof v === "string") return v.toLowerCase() === "true";
    }
    return null;
  }

  function rawNum(key: string): number | null {
    const entry = (raw as Record<string, unknown>)[key];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const v = (entry as Record<string, unknown>).value;
      return typeof v === "number" ? v : null;
    }
    return null;
  }

  return {
    vehicleId: id,
    observedAt: snapshot?.observedAt.toISOString() ?? null,
    tirePressureFrontLeft: rawStr("tirePressureStatusFrontLeft"),
    tirePressureFrontRight: rawStr("tirePressureStatusFrontRight"),
    tirePressureRearLeft: rawStr("tirePressureStatusRearLeft"),
    tirePressureRearRight: rawStr("tirePressureStatusRearRight"),
    twelveVoltBatteryHealth: rawStr("twelveVoltBatteryHealth"),
    otaCurrentVersion: rawStr("otaCurrentVersion"),
    otaAvailableVersion: rawStr("otaAvailableVersion"),
    otaInstallReady: rawBool("otaInstallReady"),
    otaInstallDuration: rawNum("otaInstallDuration"),
  };
});

app.post("/api/vehicles/:id/replay", async (request, reply) => {
  const { id } = request.params as { id: string };
  const vehicleRows = await database.db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, id)).limit(1);
  if (!vehicleRows[0]) {
    return reply.code(404).send({ message: "Vehicle not found." });
  }

  try {
    const result = await replayVehicleEvents(database.db, id);
    return { ok: true, eventsReplayed: result.processed };
  } catch (error) {
    request.log.error({ error }, "Replay failed");
    return reply.code(500).send({ message: "Replay failed." });
  }
});

if (config.WEB_DIST_DIR && existsSync(config.WEB_DIST_DIR)) {
  await app.register(fastifyStatic, {
    root: config.WEB_DIST_DIR,
    prefix: "/"
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.sendFile("index.html");
  });
}

function toVehicleSummary(row: typeof vehicles.$inferSelect): VehicleSummary {
  return {
    id: row.id,
    vinSuffix: row.vin ? row.vin.slice(-6) : null,
    name: row.name,
    model: row.model,
    softwareVersion: row.softwareVersion,
    enabled: row.enabled,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null
  };
}

function toChargingSessionSummary(row: typeof chargingSessions.$inferSelect): ChargingSessionSummary {
  return {
    confidence: row.confidence,
    cost: row.cost,
    currency: row.currency,
    endDate: row.endDate?.toISOString() ?? null,
    energyDeliveredKwh: row.energyDeliveredKwh,
    id: row.id,
    locationLabel: row.locationLabel,
    rangeAddedKm: row.rangeAddedKm,
    startDate: row.startDate.toISOString(),
    vehicleId: row.vehicleId
  };
}

function toDriveSummary(row: typeof drives.$inferSelect): DriveSummary {
  return {
    confidence: row.confidence,
    distanceKm: row.distanceKm,
    durationSeconds: row.durationSeconds,
    endBatteryLevel: row.endBatteryLevel,
    endDate: row.endDate?.toISOString() ?? null,
    endLabel: row.endLabel,
    id: row.id,
    startBatteryLevel: row.startBatteryLevel,
    startDate: row.startDate.toISOString(),
    startLabel: row.startLabel,
    vehicleId: row.vehicleId
  };
}

async function isAdminConfigured() {
  const rows = await database.db.select({ count: count() }).from(localAdminUsers);
  return Number(rows[0]?.count ?? 0) > 0;
}

async function latestDataQualityEvent(category: string) {
  const rows = await database.db
    .select({ observedAt: dataQualityEvents.observedAt })
    .from(dataQualityEvents)
    .where(eq(dataQualityEvents.category, category))
    .orderBy(desc(dataQualityEvents.observedAt))
    .limit(1);
  return rows[0] ?? null;
}

async function getLatestVehicleSnapshot(vehicleId: string) {
  const rows = await database.db
    .select()
    .from(vehicleSnapshots)
    .where(eq(vehicleSnapshots.vehicleId, vehicleId))
    .orderBy(desc(vehicleSnapshots.observedAt))
    .limit(1);
  return rows[0] ?? null;
}

function toPowerState(value: string | null | undefined): OverviewSnapshot["powerState"] {
  if (
    value === "sleep" ||
    value === "standby" ||
    value === "ready" ||
    value === "go" ||
    value === "offline"
  ) {
    return value;
  }
  return "unknown";
}

async function countDataQualityEvents(category: string, since: Date) {
  const rows = await database.db
    .select({ count: count() })
    .from(dataQualityEvents)
    .where(and(eq(dataQualityEvents.category, category), gt(dataQualityEvents.observedAt, since)));
  return Number(rows[0]?.count ?? 0);
}

async function countConfiguredCredentials() {
  const rows = await database.db.select().from(rivianCredentials);
  return rows.filter(
    (credential) =>
      credential.encryptedAccessToken &&
      credential.encryptedRefreshToken &&
      credential.encryptedUserSessionToken
  ).length;
}

async function countRawEvents(since: Date) {
  const rows = await database.db
    .select({ count: count() })
    .from(vehicleRawEvents)
    .where(gt(vehicleRawEvents.receivedAt, since));
  return Number(rows[0]?.count ?? 0);
}

async function countEnabledVehicles() {
  const rows = await database.db.select({ count: count() }).from(vehicles).where(eq(vehicles.enabled, true));
  return Number(rows[0]?.count ?? 0);
}

async function getCollectorStatus() {
  const [lastHeartbeat, enabledVehicleCount, credentialCount] = await Promise.all([
    latestDataQualityEvent("collector_heartbeat"),
    countEnabledVehicles(),
    countConfiguredCredentials()
  ]);

  if (credentialCount === 0 || enabledVehicleCount === 0) {
    return "not_configured";
  }

  if (lastHeartbeat && Date.now() - lastHeartbeat.observedAt.getTime() < 1000 * 60 * 2) {
    return "healthy";
  }

  return "degraded";
}

async function getDefaultAccount(email?: string) {
  const existingRows = await database.db.select().from(accounts).limit(1);
  const existing = existingRows[0];
  if (existing) {
    if (email && existing.email !== email) {
      const updatedRows = await database.db
        .update(accounts)
        .set({ email, updatedAt: new Date() })
        .where(eq(accounts.id, existing.id))
        .returning();
      return updatedRows[0] ?? { ...existing, email };
    }
    return existing;
  }

  const insertedRows = await database.db.insert(accounts).values({ email }).returning();
  const inserted = insertedRows[0];
  if (!inserted) {
    throw new Error("Unable to create local account.");
  }
  return inserted;
}

async function storeRivianTokens(accountId: string, email: string, tokens: RivianTokens) {
  await database.db.update(accounts).set({ email, updatedAt: new Date() }).where(eq(accounts.id, accountId));
  await database.db.delete(rivianCredentials).where(eq(rivianCredentials.accountId, accountId));
  await database.db.insert(rivianCredentials).values({
    accountId,
    encryptedAccessToken: encryptText(tokens.accessToken, config.APP_SECRET),
    encryptedRefreshToken: encryptText(tokens.refreshToken, config.APP_SECRET),
    encryptedUserSessionToken: encryptText(tokens.userSessionToken, config.APP_SECRET),
    status: "healthy"
  });
}

async function getStoredRivianTokens(accountId: string): Promise<RivianTokens | null> {
  const rows = await database.db
    .select()
    .from(rivianCredentials)
    .where(eq(rivianCredentials.accountId, accountId))
    .limit(1);
  const credential = rows[0];
  if (
    !credential?.encryptedAccessToken ||
    !credential.encryptedRefreshToken ||
    !credential.encryptedUserSessionToken
  ) {
    return null;
  }

  return {
    accessToken: decryptText(credential.encryptedAccessToken, config.APP_SECRET),
    refreshToken: decryptText(credential.encryptedRefreshToken, config.APP_SECRET),
    userSessionToken: decryptText(credential.encryptedUserSessionToken, config.APP_SECRET)
  };
}

async function discoverAndStoreVehicles(accountId: string, tokens: RivianTokens) {
  const discoveredVehicles = await rivianApi.listVehicles(tokens);
  const now = new Date();

  for (const vehicle of discoveredVehicles) {
    await database.db
      .insert(vehicles)
      .values({
        accountId,
        capabilities: vehicle.capabilities,
        enabled: true,
        lastSeenAt: now,
        model: vehicle.model,
        modelYear: vehicle.modelYear,
        name: vehicle.name,
        rivianVehicleId: vehicle.id,
        softwareVersion: vehicle.softwareVersion,
        vin: vehicle.vin
      })
      .onConflictDoUpdate({
        set: {
          capabilities: vehicle.capabilities,
          lastSeenAt: now,
          model: vehicle.model,
          modelYear: vehicle.modelYear,
          name: vehicle.name,
          softwareVersion: vehicle.softwareVersion,
          vin: vehicle.vin
        },
        target: vehicles.rivianVehicleId
      });
  }

  return discoveredVehicles.length;
}

async function deleteExpiredRivianChallenges() {
  await database.db.delete(rivianAuthChallenges).where(lt(rivianAuthChallenges.expiresAt, new Date()));
}

async function requireAuth(token: string | undefined, reply: FastifyReply) {
  if (!(await isAdminConfigured())) {
    return true;
  }

  const session = await getAuthSession(token);
  if (session.authenticated) {
    return true;
  }

  reply.code(401).send({
    message: "Authentication required."
  });
  return false;
}

async function getAdminUser() {
  const rows = await database.db.select().from(localAdminUsers).limit(1);
  return rows[0] ?? null;
}

async function createSessionForAdmin(adminUserId?: string) {
  const admin = adminUserId ? null : await getAdminUser();
  const resolvedAdminUserId = adminUserId ?? admin?.id;
  if (!resolvedAdminUserId) {
    throw new Error("Cannot create session before local admin exists.");
  }

  const token = createSessionToken();
  const expiresAt = sessionExpiresAt();
  await database.db.insert(localSessions).values({
    adminUserId: resolvedAdminUserId,
    expiresAt,
    tokenHash: hashSessionToken(token)
  });

  return { expiresAt, token };
}

async function getAuthSession(token: string | undefined): Promise<AuthSession> {
  if (!token) {
    return {
      authenticated: false,
      username: null
    };
  }

  const rows = await database.db
    .select({
      sessionId: localSessions.id,
      username: localAdminUsers.username
    })
    .from(localSessions)
    .innerJoin(localAdminUsers, eq(localSessions.adminUserId, localAdminUsers.id))
    .where(and(eq(localSessions.tokenHash, hashSessionToken(token)), gt(localSessions.expiresAt, new Date())))
    .limit(1);

  const session = rows[0];
  if (!session) {
    return {
      authenticated: false,
      username: null
    };
  }

  await database.db
    .update(localSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(localSessions.id, session.sessionId));

  return {
    authenticated: true,
    username: session.username
  };
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(sessionCookieName, token, {
    expires: expiresAt,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: false
  });
}

function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(sessionCookieName, {
    path: "/"
  });
}

function isPublicApiPath(url: string) {
  const pathname = url.split("?")[0] ?? url;
  return (
    pathname === "/api/health" ||
    pathname === "/api/setup" ||
    pathname === "/api/setup/admin" ||
    pathname === "/api/auth/session" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout"
  );
}

async function pruneExpiredSessions() {
  await database.db.delete(localSessions).where(lt(localSessions.expiresAt, new Date()));
}

// Prune expired sessions on startup and every hour
await pruneExpiredSessions();
setInterval(() => void pruneExpiredSessions(), 1000 * 60 * 60);

try {
  await app.listen({ port: config.APP_PORT, host: "0.0.0.0" });
  app.log.info(`RivianMate API listening at http://localhost:${config.APP_PORT}`);
  if (config.WEB_DIST_DIR) {
    app.log.info(`Serving React build from ${path.resolve(config.WEB_DIST_DIR)}`);
  }
} catch (error) {
  app.log.error(error);
  await database.client.end();
  process.exit(1);
}
