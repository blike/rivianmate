import { randomUUID } from "node:crypto";

export interface RivianTokens {
  accessToken: string;
  refreshToken: string;
  userSessionToken: string;
}

export interface RivianVehicle {
  id: string;
  vin: string | null;
  name: string;
  model: string | null;
  modelYear: number | null;
  softwareVersion: string | null;
  capabilities: Record<string, unknown>;
}

export interface RivianAuthResult {
  tokens?: RivianTokens;
  mfaRequired: boolean;
  otpToken?: string;
  csrfToken: string;
  appSessionToken: string;
}

export interface VehicleStateSubscription {
  unsubscribe(): Promise<void>;
}

export type VehicleStateConnectionEvent =
  | "connected"
  | "closed"
  | "error"
  | "quiet_resubscribe"
  | "reconnecting"
  | "resubscribed";

export interface VehicleStateEvent {
  vehicleId: string;
  observedAt: Date;
  raw: Record<string, unknown>;
}

export interface ChargingSessionData {
  vehicleId: string;
  observedAt: Date;
  raw: Record<string, unknown>;
}

export class RivianApiNotConfiguredError extends Error {
  constructor() {
    super("Rivian API client is not configured yet.");
  }
}

export class RivianApiError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
}

const graphqlGateway = "https://rivian.com/api/gql/gateway/graphql";
const graphqlCharging = "https://rivian.com/api/gql/chrg/user/graphql";
const graphqlWebSocket = "wss://api.rivian.com/gql-consumer-subscriptions/graphql";
const apolloClientName = "com.rivian.ios.consumer-apollo-ios";
const rivianClientVersion = "1.13.0-1494";

const vehicleStateFields = [
  "batteryLevel",
  "batteryLimit",
  "cabinClimateInteriorTemperature",
  "chargeSchedule",
  "chargerState",
  "chargerStatus",
  "cloudConnection",
  "distanceToEmpty",
  "driveMode",
  "gearStatus",
  "gnssAltitude",
  "gnssBearing",
  "gnssLocation",
  "gnssSpeed",
  "otaAvailableVersion",
  "otaAvailableVersionNumber",
  "otaCurrentVersion",
  "otaCurrentVersionNumber",
  "otaInstallDuration",
  "otaInstallReady",
  "powerState",
  "tirePressureStatusFrontLeft",
  "tirePressureStatusFrontRight",
  "tirePressureStatusRearLeft",
  "tirePressureStatusRearRight",
  "twelveVoltBatteryHealth"
];

const vehicleStateTemplateMap: Record<string, string> = {
  chargeSchedule: "{ startTime type }",
  cloudConnection: "{ lastSync isOnline }",
  gnssLocation: "{ latitude longitude timeStamp isAuthorized }"
};

const timestampedValueTemplate = "{ timeStamp value }";
const chargingValueRecordFields = [
  "current",
  "currentMiles",
  "kilometersChargedPerHour",
  "power",
  "rangeAddedThisSession",
  "soc",
  "timeRemaining",
  "totalChargedEnergy",
  "vehicleChargerState"
];

const chargingScalarFields = [
  "chargerId",
  "currentCurrency",
  "currentPrice",
  "isFreeSession",
  "isRivianCharger",
  "locationId",
  "startTime",
  "timeElapsed"
];

const baseHeaders = {
  Accept: "application/json",
  "Apollographql-Client-Name": apolloClientName,
  "Content-Type": "application/json",
  "User-Agent": "RivianApp/707 CFNetwork/1237 Darwin/20.4.0"
};

export class RivianApiClient {
  private readonly vehicleStateMonitors = new Map<string, RivianWebSocketMonitor>();

  async createSession(): Promise<{ csrfToken: string; appSessionToken: string }> {
    const response = await this.graphql<{
      createCsrfToken: {
        csrfToken: string;
        appSessionToken: string;
      };
    }>({
      operationName: "CreateCSRFToken",
      query:
        "mutation CreateCSRFToken { createCsrfToken { __typename csrfToken appSessionToken } }",
      variables: null
    });

    return response.createCsrfToken;
  }

  async authenticate(email: string, password: string): Promise<RivianAuthResult> {
    const session = await this.createSession();
    const response = await this.graphql<{
      login: {
        accessToken?: string;
        refreshToken?: string;
        userSessionToken?: string;
        otpToken?: string;
      };
    }>(
      {
        operationName: "Login",
        query:
          "mutation Login($email: String!, $password: String!) { login(email: $email, password: $password) { __typename ... on MobileLoginResponse { __typename accessToken refreshToken userSessionToken } ... on MobileMFALoginResponse { __typename otpToken } } }",
        variables: { email, password }
      },
      {
        "A-Sess": session.appSessionToken,
        "Csrf-Token": session.csrfToken
      }
    );

    if (response.login.otpToken) {
      return {
        ...session,
        mfaRequired: true,
        otpToken: response.login.otpToken
      };
    }

    if (
      !response.login.accessToken ||
      !response.login.refreshToken ||
      !response.login.userSessionToken
    ) {
      throw new RivianApiError("Rivian login response did not include tokens.");
    }

    return {
      ...session,
      mfaRequired: false,
      tokens: {
        accessToken: response.login.accessToken,
        refreshToken: response.login.refreshToken,
        userSessionToken: response.login.userSessionToken
      }
    };
  }

  async completeMfa(
    email: string,
    otpCode: string,
    otpToken: string,
    session: { csrfToken: string; appSessionToken: string }
  ): Promise<RivianTokens> {
    const response = await this.graphql<{
      loginWithOTP: {
        accessToken?: string;
        refreshToken?: string;
        userSessionToken?: string;
      };
    }>(
      {
        operationName: "LoginWithOTP",
        query:
          "mutation LoginWithOTP($email: String!, $otpCode: String!, $otpToken: String!) { loginWithOTP(email: $email, otpCode: $otpCode, otpToken: $otpToken) { __typename ... on MobileLoginResponse { __typename accessToken refreshToken userSessionToken } } }",
        variables: { email, otpCode, otpToken }
      },
      {
        "A-Sess": session.appSessionToken,
        "Csrf-Token": session.csrfToken
      }
    );

    if (
      !response.loginWithOTP.accessToken ||
      !response.loginWithOTP.refreshToken ||
      !response.loginWithOTP.userSessionToken
    ) {
      throw new RivianApiError("Rivian MFA response did not include tokens.");
    }

    return {
      accessToken: response.loginWithOTP.accessToken,
      refreshToken: response.loginWithOTP.refreshToken,
      userSessionToken: response.loginWithOTP.userSessionToken
    };
  }

  async listVehicles(tokens: RivianTokens): Promise<RivianVehicle[]> {
    const session = await this.createSession();
    const response = await this.graphql<{
      currentUser: {
        vehicles?: Array<{
          id?: string;
          vin?: string | null;
          name?: string | null;
          vehicle?: {
            model?: string | null;
            modelYear?: number | null;
            vehicleState?: {
              supportedFeatures?: Array<{
                name?: string | null;
                status?: string | null;
              }>;
            } | null;
          } | null;
        }>;
      };
    }>(
      {
        operationName: "getUserInfo",
        query:
          "query getUserInfo { currentUser { __typename id vehicles { id vin name roles state vehicle { __typename id vin modelYear make model vehicleState { supportedFeatures { __typename name status } } } } registrationChannels { type } } }",
        variables: null
      },
      {
        "A-Sess": session.appSessionToken,
        "U-Sess": tokens.userSessionToken
      }
    );

    return (response.currentUser.vehicles ?? [])
      .filter((vehicle) => vehicle.id)
      .map((vehicle) => {
        const supportedFeatures =
          vehicle.vehicle?.vehicleState?.supportedFeatures?.filter(
            (feature) => feature.name && feature.status === "AVAILABLE"
          ) ?? [];

        return {
          capabilities: {
            supportedFeatures: supportedFeatures.map((feature) => feature.name)
          },
          id: vehicle.id as string,
          model: vehicle.vehicle?.model ?? null,
          modelYear: vehicle.vehicle?.modelYear ?? null,
          name: vehicle.name ?? vehicle.vehicle?.model ?? "Rivian",
          softwareVersion: null,
          vin: vehicle.vin ?? null
        };
      });
  }

  async subscribeToVehicleState(
    tokens: RivianTokens,
    vehicleId: string,
    onEvent: (event: VehicleStateEvent) => void,
    onClose?: () => void,
    onConnectionEvent?: (type: VehicleStateConnectionEvent, detail: Record<string, unknown>) => void
  ): Promise<VehicleStateSubscription> {
    const monitor = this.getVehicleStateMonitor(tokens, onConnectionEvent);
    let active = true;
    const unsubscribe = await monitor.startSubscription(
      {
        operationName: "VehicleState",
        query: `subscription VehicleState($vehicleID: String!) { vehicleState(id: $vehicleID) ${buildVehicleStateFragment()} }`,
        variables: {
          vehicleID: vehicleId
        }
      },
      (payload) => {
        const data = payload.data as { vehicleState?: Record<string, unknown> } | undefined;
        if (!data?.vehicleState) {
          return;
        }

        onEvent({
          observedAt: inferObservedAt(data.vehicleState),
          raw: data.vehicleState,
          vehicleId
        });
      }
    );

    return {
      async unsubscribe() {
        active = false;
        await unsubscribe();
        if (!active) return;
        onClose?.();
      }
    };
  }

  async closeVehicleStateConnections() {
    await Promise.all([...this.vehicleStateMonitors.values()].map((monitor) => monitor.close()));
    this.vehicleStateMonitors.clear();
  }

  async fetchLiveChargingSession(
    tokens: RivianTokens,
    vehicleId: string
  ): Promise<ChargingSessionData> {
    const session = await this.createSession();
    const response = await this.graphql<{
      getLiveSessionData: Record<string, unknown> | null;
    }>(
      {
        operationName: "getLiveSessionData",
        query: `query getLiveSessionData($vehicleId: ID!) { getLiveSessionData(vehicleId: $vehicleId) { __typename ${buildChargingSessionFragment()} } }`,
        variables: { vehicleId }
      },
      {
        "A-Sess": session.appSessionToken,
        "U-Sess": tokens.userSessionToken
      },
      graphqlCharging
    );

    return {
      observedAt: inferChargingObservedAt(response.getLiveSessionData ?? {}),
      raw: response.getLiveSessionData ?? {},
      vehicleId
    };
  }

  private async graphql<TData>(
    body: {
      operationName: string;
      query: string;
      variables: Record<string, unknown> | null;
    },
    headers: Record<string, string> = {},
    url = graphqlGateway
  ): Promise<TData> {
    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers: {
        ...baseHeaders,
        ...headers
      },
      method: "POST"
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          data?: TData;
          errors?: Array<{ message?: string; extensions?: { error_code?: string } }>;
        }
      | null;

    const error = payload?.errors?.[0];
    if (error) {
      throw new RivianApiError(
        error.message ?? "Rivian API returned an error.",
        error.extensions?.error_code
      );
    }

    if (!response.ok) {
      throw new RivianApiError(`Rivian API returned HTTP ${response.status}.`);
    }

    if (!payload?.data) {
      throw new RivianApiError("Rivian API response did not include data.");
    }

    return payload.data;
  }

  private getVehicleStateMonitor(
    tokens: RivianTokens,
    onConnectionEvent?: (type: VehicleStateConnectionEvent, detail: Record<string, unknown>) => void
  ) {
    const existing = this.vehicleStateMonitors.get(tokens.userSessionToken);
    if (existing) {
      existing.addConnectionListener(onConnectionEvent);
      return existing;
    }

    const monitor = new RivianWebSocketMonitor(tokens.userSessionToken);
    monitor.addConnectionListener(onConnectionEvent);
    this.vehicleStateMonitors.set(tokens.userSessionToken, monitor);
    return monitor;
  }
}

type GraphqlPayload = {
  data?: unknown;
};

type SubscriptionRecord = {
  onMessage(payload: GraphqlPayload): void;
  payload: Record<string, unknown>;
};

class RivianWebSocketMonitor {
  private acked = false;
  private ackWaiters: Array<() => void> = [];
  private connectPromise: Promise<void> | null = null;
  private disconnectRequested = false;
  private lastReceivedAt = 0;
  private quietTimer: NodeJS.Timeout | undefined;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private readonly subscriptions = new Map<string, SubscriptionRecord>();
  private readonly connectionListeners = new Set<
    (type: VehicleStateConnectionEvent, detail: Record<string, unknown>) => void
  >();
  private socket: WebSocket | undefined;

  constructor(private readonly userSessionToken: string) {}

  addConnectionListener(listener?: (type: VehicleStateConnectionEvent, detail: Record<string, unknown>) => void) {
    if (listener) {
      this.connectionListeners.add(listener);
    }
  }

  async startSubscription(
    payload: Record<string, unknown>,
    onMessage: (payload: GraphqlPayload) => void
  ): Promise<() => Promise<void>> {
    await this.connect();
    await this.waitForAck();

    const id = randomUUID();
    this.subscriptions.set(id, { onMessage, payload });
    this.send({ id, payload, type: "subscribe" });

    return async () => {
      this.subscriptions.delete(id);
      if (this.isOpen()) {
        this.send({ id, type: "complete" });
      }
      if (this.subscriptions.size === 0) {
        await this.close();
      }
    };
  }

  async close() {
    this.disconnectRequested = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.quietTimer) clearInterval(this.quietTimer);
    this.reconnectTimer = undefined;
    this.quietTimer = undefined;
    this.acked = false;
    this.ackWaiters.splice(0).forEach((resolve) => resolve());
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      this.socket.close();
    }
    this.socket = undefined;
  }

  private async connect() {
    if (this.isOpen() && this.acked) return;
    if (this.connectPromise) return this.connectPromise;

    this.disconnectRequested = false;
    this.connectPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(graphqlWebSocket, "graphql-transport-ws");
      let settled = false;
      const settle = (error?: unknown) => {
        if (settled) return;
        settled = true;
        this.connectPromise = null;
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      this.socket = socket;
      this.acked = false;

      socket.addEventListener("open", () => {
        this.lastReceivedAt = Date.now();
        this.send({
          payload: {
            "client-name": apolloClientName,
            "client-version": rivianClientVersion,
            "dc-cid": `m-ios-${randomUUID()}`,
            "u-sess": this.userSessionToken
          },
          type: "connection_init"
        });
        this.startQuietTimer();
        settle();
      });

      socket.addEventListener("message", (event) => {
        this.lastReceivedAt = Date.now();
        this.handleMessage(event.data);
      });

      socket.addEventListener("error", () => {
        this.emit("error", {});
        settle(new RivianApiError("Rivian vehicle-state WebSocket failed to connect."));
      });

      socket.addEventListener("close", (event) => {
        this.acked = false;
        this.ackWaiters.splice(0).forEach((resolve) => resolve());
        this.emit("closed", { code: event.code, reason: event.reason || null });
        settle(new RivianApiError("Rivian vehicle-state WebSocket closed before it was ready."));
        if (!this.disconnectRequested && event.reason !== "Unauthenticated") {
          this.scheduleReconnect();
        }
      });
    });

    return this.connectPromise;
  }

  private handleMessage(rawData: unknown) {
    const text = typeof rawData === "string" ? rawData : rawData instanceof Buffer ? rawData.toString("utf8") : String(rawData);
    let message: {
      id?: string;
      payload?: GraphqlPayload;
      type?: string;
    };

    try {
      message = JSON.parse(text) as typeof message;
    } catch (error) {
      this.emit("error", { message: error instanceof Error ? error.message : String(error) });
      return;
    }

    if (message.type === "connection_ack") {
      this.acked = true;
      this.reconnectAttempt = 0;
      this.emit("connected", {});
      this.ackWaiters.splice(0).forEach((resolve) => resolve());
      return;
    }

    if (message.type !== "next" || !message.id) {
      return;
    }

    this.subscriptions.get(message.id)?.onMessage(message.payload ?? {});
  }

  private async waitForAck(timeoutMs = 10000) {
    if (this.acked) return;

    await new Promise<void>((resolve, reject) => {
      const waiter = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        this.ackWaiters = this.ackWaiters.filter((candidate) => candidate !== waiter);
        reject(new RivianApiError("Timed out waiting for Rivian WebSocket connection_ack."));
      }, timeoutMs);

      this.ackWaiters.push(waiter);
    });

    if (!this.acked) {
      throw new RivianApiError("Rivian WebSocket closed before connection_ack.");
    }
  }

  private startQuietTimer() {
    if (this.quietTimer) return;
    this.quietTimer = setInterval(() => {
      if (!this.isOpen() || !this.acked || this.subscriptions.size === 0) return;
      if (Date.now() - this.lastReceivedAt < 60000) return;
      this.resubscribeAll("quiet_resubscribe");
    }, 60000);
  }

  private scheduleReconnect() {
    if (this.disconnectRequested || this.reconnectTimer || this.subscriptions.size === 0) return;
    const delaySeconds = Math.min(2 ** this.reconnectAttempt + Math.random(), 300);
    this.reconnectAttempt += 1;
    this.emit("reconnecting", { delaySeconds });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.reconnect();
    }, delaySeconds * 1000);
  }

  private async reconnect() {
    if (this.disconnectRequested || this.subscriptions.size === 0) return;
    try {
      await this.connect();
      await this.waitForAck();
      this.resubscribeAll("resubscribed");
    } catch (error) {
      this.emit("error", { message: error instanceof Error ? error.message : String(error) });
      this.scheduleReconnect();
    }
  }

  private resubscribeAll(event: "quiet_resubscribe" | "resubscribed") {
    for (const [id, subscription] of this.subscriptions) {
      this.send({ id, payload: subscription.payload, type: "subscribe" });
    }
    this.lastReceivedAt = Date.now();
    this.emit(event, { subscriptionCount: this.subscriptions.size });
  }

  private send(message: Record<string, unknown>) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new RivianApiError("Rivian vehicle-state WebSocket is not open.");
    }
    socket.send(JSON.stringify(message));
  }

  private isOpen() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private emit(type: VehicleStateConnectionEvent, detail: Record<string, unknown>) {
    for (const listener of this.connectionListeners) {
      listener(type, detail);
    }
  }
}

function buildVehicleStateFragment() {
  const fields = vehicleStateFields
    .map((field) => `${field} ${vehicleStateTemplateMap[field] ?? timestampedValueTemplate}`)
    .join(" ");
  return `{ ${fields} }`;
}

function buildChargingSessionFragment() {
  return [
    ...chargingScalarFields,
    ...chargingValueRecordFields.map((field) => `${field} { __typename value updatedAt }`)
  ].join(" ");
}

function inferObservedAt(raw: Record<string, unknown>) {
  const timestamps = Object.values(raw)
    .map((value) => {
      if (!isRecord(value)) {
        return null;
      }
      const timestamp = value.timeStamp;
      return typeof timestamp === "string" ? Date.parse(timestamp) : null;
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (timestamps.length === 0) {
    return new Date();
  }

  return new Date(Math.max(...timestamps));
}

function inferChargingObservedAt(raw: Record<string, unknown>) {
  const timestamps = Object.values(raw)
    .map((value) => {
      if (!isRecord(value)) {
        return null;
      }
      const timestamp = value.updatedAt;
      return typeof timestamp === "string" ? Date.parse(timestamp) : null;
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (timestamps.length > 0) {
    return new Date(Math.max(...timestamps));
  }

  const startTime = raw.startTime;
  if (typeof startTime === "string") {
    const parsed = Date.parse(startTime);
    if (Number.isFinite(parsed)) {
      return new Date(parsed);
    }
  }

  return new Date();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
