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
  /** The vehicle's own fix from a navigation frame; never mixed into `gnssLocation`. */
  navLocation?: NavLocation;
  [property: string]: TimeStampedValue | CloudConnection | GnssLocation | NavLocation | undefined;
}

/** A navigation frame's fix: where the vehicle was, when, and what it read there. */
export interface NavLocation extends GnssLocation {
  /** Speed (m/s); 0 when the frame leaves it out, as at a standstill. */
  speedMps?: number | null;
  /** Heading (°, 0–360). */
  bearing?: number | null;
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
  { kind: 'tokens'; tokens: RivianTokens } | { kind: 'otp'; otpToken: string };

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

/**
 * One of the account's orders, from the orders service. Observed values:
 * `state` ORDERED, CANCELLED (stays ORDERED after delivery);
 * `configurationStatus` SOFT_LOCKED; `fulfillmentSummaryStatus`
 * PENDING_FULFILLMENT, READY_FOR_FULFILLMENT, VEHICLE_DELIVERED.
 * These lag the physical car by days to weeks: an order can still read
 * PENDING_FULFILLMENT after the vehicle is built.
 */
export interface OrderSnapshot {
  id: string;
  state: string;
  configurationStatus: string | null;
  fulfillmentSummaryStatus: string | null;
  /** Set once Rivian ties the order to a vehicle (getUserInfo's vehicles[].id). */
  vehicleId: string | null;
  /** Often null for weeks after the vehicle has one; the order's vehicle record has it first. */
  vin: string | null;
}

/** One order in detail, from the orders service's `order(id)`. */
export interface OrderDetail {
  id: string;
  /** VEHICLE for a vehicle order; gear and accessories have other types. */
  type: string | null;
  state: string | null;
  orderDate: string | null;
  configurationStatus: string | null;
  fulfillmentSummaryStatus: string | null;
  /** Rivian's build record, once the order is assigned to one. */
  vehicle: OrderVehicle | null;
  items: OrderItem[];
  /** Every payment recorded against the order, oldest first. */
  payments: OrderPayment[];
  /** The earliest estimated delivery window among the order's fulfillments. */
  estimatedDelivery: { start: string | null; end: string | null } | null;
}

/**
 * The build record behind an order. `actualGeneralAssemblyDate` is what
 * happened; the planned and expected dates are schedules Rivian revises, so
 * one falling after the actual date is normal.
 */
export interface OrderVehicle {
  /** Rivian's internal id (getUserInfo's vehicles[].id), not a VIN. */
  vehicleId: string | null;
  /** The VIN to trust: the order's own `vin` lags this by weeks. */
  vin: string | null;
  modelYear: string | null;
  model: string | null;
  make: string | null;
  plannedBuildDate: string | null;
  expectedBuildDate: string | null;
  expectedGeneralAssemblyStartDate: string | null;
  actualGeneralAssemblyDate: string | null;
  /**
   * Observed: FACTORY_OK, FACTORY_GATED, STAGED_FOR_PDI, PDI_COMPLETED,
   * VEHICLE_PREPPED, DELIVERED. Steps can be skipped, and it lags the car by days.
   */
  status: string | null;
}

/**
 * A payment recorded against an order. A scheduled ACH stays PROCESSING until
 * it clears, so not every record is money already paid.
 */
export interface OrderPayment {
  id: string | null;
  amount: number | null;
  /** Observed: SUCCEEDED, PROCESSING, CANCELED. */
  status: string | null;
  /** e.g. CARD, ACH. */
  method: string | null;
  /** e.g. DEPOSIT, BALANCE. */
  type: string | null;
  /** e.g. DEPOSIT, PURCHASE. */
  intent: string | null;
  date: string | null;
}

export interface OrderItem {
  type: string | null;
  title: string | null;
  /** Configured options, e.g. { group: "PAINT", id: "…", name: "Launch Green" }. */
  options: { group: string | null; id: string | null; name: string | null }[];
}

/** An order's delivery appointment, from the gateway's `delivery(orderId)`. */
export interface Delivery {
  /** e.g. DELIVERY_ACCEPTED. */
  status: string | null;
  /** e.g. THIRD_PARTY. */
  carrier: string | null;
  vin: string | null;
  appointment: {
    id: string | null;
    /** Local wall-clock times in `timeZone` (no offset), e.g. 2027-02-06T10:30:00. */
    start: string | null;
    end: string | null;
    /** IANA zone, e.g. America/Indiana/Indianapolis. */
    timeZone: string | null;
  } | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    zipcode: string | null;
  } | null;
}

/** How the vehicle left the factory. Option names are Rivian's, e.g. "R1S Dual". */
export interface VehicleDetails {
  /** Local date the vehicle finished general assembly, YYYY-MM-DD. */
  builtOn: string | null;
  trim: string | null;
  driveSystem: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  wheels: string | null;
  tonneau: string | null;
}

/** The angles RivianMate shows of Rivian's vehicle renders. */
export const VEHICLE_VIEWS = ['three-quarter', 'overhead'] as const;
export type VehicleView = (typeof VEHICLE_VIEWS)[number];

/** Render URLs by view. Rivian tokenizes them, so they stay on the server. */
export type VehicleImageUrls = Partial<Record<VehicleView, string>>;

export interface UserInfo {
  id: string;
  vehicles: UserVehicle[];
}

export interface LiveSessionValueRecord {
  value: string | number | null;
  updatedAt: string;
}

/** A charging schedule set in the Rivian app. Times are minutes after midnight. */
export interface ChargingSchedule {
  enabled: boolean | null;
  startTime: number | null;
  duration: number | null;
  amperage: number | null;
  weekDays: string[] | null;
  location: { latitude: number | null; longitude: number | null } | null;
}

/** A departure (precondition) schedule. */
export interface DepartureSchedule {
  id: string;
  name: string | null;
  enabled: boolean | null;
  occurrence: {
    type: string | null;
    weekDays: string[] | null;
    timeOfDayMinutes: number | null;
  } | null;
  comfortSettings: {
    /** Heat or vent level per seat and the wheel, by Rivian's field (`frontLeftSeat`, `steeringWheel`…), as set. */
    surfaces: Record<string, string>;
    cabinClimateSetTemp: number | null;
    defrost: boolean | string | null;
  } | null;
}

/** A completed session from Rivian's charging history (account-wide). */
/** A release-notes PDF; `url` is presigned and expires after about an hour. */
export interface OtaReleaseNotes {
  url: string | null;
  version: string | null;
  locale: string | null;
}

export interface OtaUpdateDetails {
  current: OtaReleaseNotes | null;
  available: OtaReleaseNotes | null;
}

export interface ChargeSessionSummary {
  transactionId: string | null;
  startInstant: string | null;
  endInstant: string | null;
  totalEnergyKwh: number | null;
  rangeAddedKm: number | null;
  vendor: string | null;
  paidTotal: number | null;
  chargerType: string | null;
  currencyCode: string | null;
  city: string | null;
  vehicleId: string | null;
  isPublic: boolean | null;
  isHomeCharger: boolean | null;
}

/** One observed point on a session's charging curve. */
export interface ChargingCurveSample {
  ts: string;
  powerKw: number | null;
  soc: number | null;
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
  /** Charge limit (%) and pack capacity (kWh), from Parallax when known. */
  socLimit?: LiveSessionValueRecord | null;
  batteryCapacityKwh?: LiveSessionValueRecord | null;
  /** Curve points pushed by the chargingSession subscription. */
  chart?: ChargingCurveSample[];
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
  | 'UNAUTHENTICATED'
  | 'RATE_LIMIT'
  | 'SESSION_MANAGER_ERROR'
  | 'DATA_ERROR'
  | 'BAD_REQUEST_ERROR'
  | 'BAD_CURRENT_PASSWORD'
  | 'BAD_USER_INPUT'
  | 'INTERNAL_SERVER_ERROR'
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
  const message = first?.message ?? 'Rivian API error';

  if (
    (code === 'BAD_USER_INPUT' && reason === 'INVALID_OTP') ||
    (code === 'UNAUTHENTICATED' && reason === 'OTP_TOKEN_EXPIRED')
  ) {
    return new RivianInvalidOtpError(message, code, reason, status, response);
  }
  switch (code) {
    case 'UNAUTHENTICATED':
      return new RivianUnauthenticatedError(message, code, reason, status, response);
    case 'BAD_CURRENT_PASSWORD':
      return new RivianInvalidCredentialsError(message, code, reason, status, response);
    case 'RATE_LIMIT':
      return new RivianRateLimitError(message, code, reason, status, response);
    case 'SESSION_MANAGER_ERROR':
      return new RivianSessionManagerError(message, code, reason, status, response);
    case 'DATA_ERROR':
      return new RivianDataError(message, code, reason, status, response);
    case 'BAD_REQUEST_ERROR':
      return new RivianBadRequestError(message, code, reason, status, response);
    default:
      return new RivianApiError(message, code, reason, status, response);
  }
}

/** True when Rivian rejected the GraphQL document itself (schema mismatch). */
export function isGraphqlValidationError(err: unknown): boolean {
  if (!(err instanceof RivianApiError)) return false;
  return err.code === 'GRAPHQL_VALIDATION_FAILED' || /validation/i.test(err.message);
}

/**
 * Full description of a Rivian error, including every GraphQL error entry,
 * so logs show which field or rule was rejected.
 */
export function describeRivianError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const response = (err as RivianApiError).response as { errors?: unknown[] } | undefined;
  if (!response?.errors?.length) return err.message;
  return JSON.stringify(response.errors).slice(0, 1000);
}
