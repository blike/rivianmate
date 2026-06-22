import { createClient } from "graphql-ws";
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
    onClose?: () => void
  ): Promise<VehicleStateSubscription> {
    const client = createClient({
      connectionParams: {
        "client-name": apolloClientName,
        "client-version": rivianClientVersion,
        "dc-cid": `m-ios-${randomUUID()}`,
        "u-sess": tokens.userSessionToken
      },
      lazy: false,
      retryAttempts: 1000,
      retryWait: async (retries) => {
        // Exponential backoff: 5s, 10s, 20s … capped at 5 min
        const delay = Math.min(5000 * Math.pow(2, retries - 1), 300_000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      },
      url: graphqlWebSocket,
      webSocketImpl: WebSocket
    });

    let disposed = false;

    const dispose = client.subscribe(
      {
        operationName: "VehicleState",
        query: `subscription VehicleState($vehicleID: String!) { vehicleState(id: $vehicleID) ${buildVehicleStateFragment()} }`,
        variables: {
          vehicleID: vehicleId
        }
      },
      {
        complete: () => {
          if (!disposed) onClose?.();
        },
        error: () => {
          if (!disposed) onClose?.();
        },
        next: (payload) => {
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
      }
    );

    return {
      async unsubscribe() {
        disposed = true;
        dispose();
        await client.dispose();
      }
    };
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
