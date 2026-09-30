/** Shapes returned by the Rivian cloud GraphQL API. */

export interface TimeStampedValue {
  timeStamp: string;
  value: string | number | null;
}

export interface GnssLocation {
  latitude: number;
  longitude: number;
  timeStamp: string;
  isAuthorized?: boolean;
}

export interface CloudConnection {
  lastSync: string | null;
  isOnline: boolean;
}

/** Merged vehicle state: property name -> value record (or special shapes). */
export interface VehicleState {
  cloudConnection?: CloudConnection;
  gnssLocation?: GnssLocation;
  [property: string]: TimeStampedValue | CloudConnection | GnssLocation | undefined;
}

export interface RivianTokens {
  accessToken: string;
  refreshToken: string;
  userSessionToken: string;
}

/** Short-lived app session created by CreateCSRFToken (not persisted). */
export interface RivianAppSession {
  csrfToken: string;
  appSessionToken: string;
}

export type LoginResult =
  | { kind: "tokens"; tokens: RivianTokens }
  | { kind: "otp"; otpToken: string };

export interface UserVehicle {
  id: string;
  vin: string;
  name: string | null;
  roles: string[] | null;
  state: string | null;
  vehicle: {
    id: string;
    vin: string;
    modelYear: number | null;
    make: string | null;
    model: string | null;
    vehicleState?: {
      supportedFeatures?: { name: string; status: string }[];
    } | null;
  } | null;
}

export interface UserInfo {
  id: string;
  vehicles: UserVehicle[];
}

export interface LiveSessionValueRecord {
  value: string | number | null;
  updatedAt: string;
}

export interface LiveSessionData {
  chargerId: string | null;
  currentCurrency: string | null;
  currentPrice: number | null;
  isFreeSession: boolean | null;
  isRivianCharger: boolean | null;
  locationId: string | null;
  startTime: string | null;
  timeElapsed: number | string | null;
  current?: LiveSessionValueRecord | null;
  currentMiles?: LiveSessionValueRecord | null;
  kilometersChargedPerHour?: LiveSessionValueRecord | null;
  power?: LiveSessionValueRecord | null;
  rangeAddedThisSession?: LiveSessionValueRecord | null;
  soc?: LiveSessionValueRecord | null;
  timeRemaining?: LiveSessionValueRecord | null;
  totalChargedEnergy?: LiveSessionValueRecord | null;
  vehicleChargerState?: LiveSessionValueRecord | null;
}

export interface Wallbox {
  wallboxId: string;
  userId: string | null;
  wifiId: string | null;
  name: string | null;
  linked: boolean | null;
  latitude: number | null;
  longitude: number | null;
  chargingStatus: string | null;
  power: number | null;
  currentVoltage: number | null;
  currentAmps: number | null;
  softwareVersion: string | null;
  model: string | null;
  serialNumber: string | null;
  maxAmps: number | null;
  maxVoltage: number | null;
  maxPower: number | null;
}

export type RivianErrorCode =
  | "UNAUTHENTICATED"
  | "RATE_LIMIT"
  | "SESSION_MANAGER_ERROR"
  | "DATA_ERROR"
  | "BAD_REQUEST_ERROR"
  | "BAD_CURRENT_PASSWORD"
  | "BAD_USER_INPUT"
  | "INTERNAL_SERVER_ERROR"
  | (string & {});

export class RivianApiError extends Error {
  constructor(
    message: string,
    public readonly code?: RivianErrorCode,
    public readonly reason?: string,
    public readonly status?: number,
    public readonly response?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class RivianUnauthenticatedError extends RivianApiError {}
export class RivianInvalidCredentialsError extends RivianApiError {}
export class RivianInvalidOtpError extends RivianApiError {}
export class RivianRateLimitError extends RivianApiError {
  /** How long Rivian asked us to back off, when it said so. */
  retryAfterMs?: number;
}
/**
 * Raised locally, without contacting Rivian, while a rate-limit cooldown is
 * in effect. It must not extend the cooldown.
 */
export class RivianCooldownError extends RivianRateLimitError {}
export class RivianSessionManagerError extends RivianApiError {}
export class RivianDataError extends RivianApiError {}
export class RivianBadRequestError extends RivianApiError {}

interface GraphqlErrorEntry {
  message?: string;
  extensions?: { code?: string; reason?: string };
}

export function mapGraphqlError(
  errors: GraphqlErrorEntry[],
  status?: number,
  response?: unknown,
): RivianApiError {
  const first = errors[0];
  const code = first?.extensions?.code;
  const reason = first?.extensions?.reason;
  const message = first?.message ?? "Rivian API error";

  if (
    (code === "BAD_USER_INPUT" && reason === "INVALID_OTP") ||
    (code === "UNAUTHENTICATED" && reason === "OTP_TOKEN_EXPIRED")
  ) {
    return new RivianInvalidOtpError(message, code, reason, status, response);
  }
  switch (code) {
    case "UNAUTHENTICATED":
      return new RivianUnauthenticatedError(message, code, reason, status, response);
    case "BAD_CURRENT_PASSWORD":
      return new RivianInvalidCredentialsError(message, code, reason, status, response);
    case "RATE_LIMIT":
      return new RivianRateLimitError(message, code, reason, status, response);
    case "SESSION_MANAGER_ERROR":
      return new RivianSessionManagerError(message, code, reason, status, response);
    case "DATA_ERROR":
      return new RivianDataError(message, code, reason, status, response);
    case "BAD_REQUEST_ERROR":
      return new RivianBadRequestError(message, code, reason, status, response);
    default:
      return new RivianApiError(message, code, reason, status, response);
  }
}
