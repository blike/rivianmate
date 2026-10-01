/**
 * GraphQL documents and field lists, ported from rivian-python-client
 * (src/rivian/const.py and rivian.py).
 */

export const GRAPHQL_GATEWAY = "https://rivian.com/api/gql/gateway/graphql";
export const GRAPHQL_CHARGING = "https://rivian.com/api/gql/chrg/user/graphql";
export const GRAPHQL_WEBSOCKET =
  "wss://api.rivian.com/gql-consumer-subscriptions/graphql";

export const APOLLO_CLIENT_NAME = "com.rivian.ios.consumer-apollo-ios";
export const APOLLO_CLIENT_VERSION = "1.13.0-1494";

export const BASE_HEADERS = {
  "User-Agent": "RivianApp/707 CFNetwork/1237 Darwin/20.4.0",
  Accept: "application/json",
  "Content-Type": "application/json",
  "Apollographql-Client-Name": APOLLO_CLIENT_NAME,
} as const;

export const CREATE_CSRF_TOKEN = `mutation CreateCSRFToken { createCsrfToken { __typename csrfToken appSessionToken } }`;

export const LOGIN = `mutation Login($email: String!, $password: String!) { login(email: $email, password: $password) { __typename ... on MobileLoginResponse { __typename accessToken refreshToken userSessionToken } ... on MobileMFALoginResponse { __typename otpToken } } }`;

export const LOGIN_WITH_OTP = `mutation LoginWithOTP($email: String!, $otpCode: String!, $otpToken: String!) { loginWithOTP(email: $email, otpCode: $otpCode, otpToken: $otpToken) { __typename ... on MobileLoginResponse { __typename accessToken refreshToken userSessionToken } } }`;

export const GET_USER_INFO = `query getUserInfo { currentUser { __typename id vehicles { id vin name roles state createdAt updatedAt vehicle { __typename id vin modelYear make model vehicleState { supportedFeatures { __typename name status } } } } } }`;

export const GET_OTA_UPDATE_DETAILS = `query getOTAUpdateDetails($vehicleId: String!) { getOTAUpdateDetails(vehicleId: $vehicleId) { releaseNotesUrl } }`;

export const GET_REGISTERED_WALLBOXES = `query getRegisteredWallboxes { getRegisteredWallboxes { __typename wallboxId userId wifiId name linked latitude longitude chargingStatus power currentVoltage currentAmps softwareVersion model serialNumber maxAmps maxVoltage maxPower } }`;

/**
 * Vehicle-state properties requested by both the query and the subscription.
 *
 * Kept to fields the current Rivian schema accepts: GraphQL validates the
 * whole document, so one unknown field rejects the entire query (HTTP) or
 * ends the subscription. Known-rejected fields (e.g.
 * cabinClimateExteriorTemperature, vehiclePowerOutput,
 * regenerativeBrakingPower, cabinClimateRunning) are deliberately absent.
 */
export const VEHICLE_STATE_PROPERTIES: readonly string[] = [
  "cloudConnection",
  "powerState",
  "chargerState",
  "chargerStatus",
  "timeToEndOfCharge",
  "batteryLevel",
  "batteryCapacity",
  "batteryLimit",
  "distanceToEmpty",
  "gnssLocation",
  "gnssSpeed",
  "gnssAltitude",
  "gnssBearing",
  "driveMode",
  "gearStatus",
  "vehicleMileage",
  "tirePressureStatusFrontLeft",
  "tirePressureStatusValidFrontLeft",
  "tirePressureStatusFrontRight",
  "tirePressureStatusValidFrontRight",
  "tirePressureStatusRearLeft",
  "tirePressureStatusValidRearLeft",
  "tirePressureStatusRearRight",
  "tirePressureStatusValidRearRight",
  "doorFrontLeftLocked",
  "doorFrontRightLocked",
  "doorRearLeftLocked",
  "doorRearRightLocked",
  "doorFrontLeftClosed",
  "doorFrontRightClosed",
  "doorRearLeftClosed",
  "doorRearRightClosed",
  "closureFrunkLocked",
  "closureFrunkClosed",
  "closureLiftgateLocked",
  "closureLiftgateClosed",
  "closureTailgateLocked",
  "closureTailgateClosed",
  "otaAvailableVersion",
  "batteryCellType",
  "otaCurrentVersion",
  "otaStatus",
  "otaCurrentStatus",
  "cabinClimateInteriorTemperature",
  "cabinClimateDriverTemperature",
  "batteryHvThermalEvent",
  "twelveVoltBatteryHealth",
  "chargePortState",
  "chargerDerateStatus",
  "cabinPreconditioningStatus",
  "cabinPreconditioningType",
  "petModeStatus",
  "petModeTemperatureStatus",
  "defrostDefogStatus",
  "steeringWheelHeat",
  "seatFrontLeftHeat",
  "seatFrontRightHeat",
  "seatRearLeftHeat",
  "seatRearRightHeat",
  "seatFrontLeftVent",
  "seatFrontRightVent",
  "closureTonneauLocked",
  "closureTonneauClosed",
  "closureSideBinLeftLocked",
  "closureSideBinLeftClosed",
  "closureSideBinRightLocked",
  "closureSideBinRightClosed",
  "windowFrontLeftClosed",
  "windowFrontRightClosed",
  "windowRearLeftClosed",
  "windowRearRightClosed",
  "gearGuardLocked",
  "gearGuardVideoStatus",
  "wiperFluidState",
  "brakeFluidLow",
  "alarmSoundStatus",
  "serviceMode",
];

/** Only valid on the WebSocket subscription — must NOT be polled. */
export const SUBSCRIPTION_ONLY_PROPERTIES: readonly string[] = [
  "tirePressureFrontLeft",
  "tirePressureFrontRight",
  "tirePressureRearLeft",
  "tirePressureRearRight",
];

export const SUBSCRIPTION_PROPERTIES: readonly string[] = [
  ...VEHICLE_STATE_PROPERTIES,
  ...SUBSCRIPTION_ONLY_PROPERTIES,
];

/**
 * Minimal fallback used when Rivian rejects the full selection without
 * naming the offending field. Covers what drive detection, charging and
 * history depend on.
 */
export const CORE_VEHICLE_STATE_PROPERTIES: readonly string[] = [
  "cloudConnection",
  "powerState",
  "gearStatus",
  "driveMode",
  "batteryLevel",
  "batteryLimit",
  "batteryCapacity",
  "distanceToEmpty",
  "vehicleMileage",
  "gnssLocation",
  "gnssSpeed",
  "chargerState",
  "chargerStatus",
  "chargePortState",
  "timeToEndOfCharge",
];

const PROPERTY_TEMPLATES: Record<string, string> = {
  cloudConnection: "{ lastSync isOnline }",
  gnssLocation: "{ latitude longitude timeStamp }",
};
const VALUE_TEMPLATE = "{ timeStamp value }";

export function buildVehicleStateFragment(
  properties: readonly string[],
): string {
  return properties
    .map((p) => `${p} ${PROPERTY_TEMPLATES[p] ?? VALUE_TEMPLATE}`)
    .join(" ");
}

export function buildVehicleStateQuery(properties: readonly string[]): string {
  return `query GetVehicleState($vehicleID: String!) { vehicleState(id: $vehicleID) { ${buildVehicleStateFragment(properties)} } }`;
}

export function buildVehicleStateSubscription(
  properties: readonly string[],
): string {
  return `subscription VehicleState($vehicleID: String!) { vehicleState(id: $vehicleID) { ${buildVehicleStateFragment(properties)} } }`;
}

const LIVE_SESSION_VALUE_RECORD_KEYS = new Set([
  "current",
  "currentMiles",
  "kilometersChargedPerHour",
  "power",
  "rangeAddedThisSession",
  "soc",
  "timeRemaining",
  "totalChargedEnergy",
  "vehicleChargerState",
]);

export const LIVE_SESSION_PROPERTIES: readonly string[] = [
  "chargerId",
  "current",
  "currentCurrency",
  "currentMiles",
  "currentPrice",
  "isFreeSession",
  "isRivianCharger",
  "kilometersChargedPerHour",
  "locationId",
  "power",
  "rangeAddedThisSession",
  "soc",
  "startTime",
  "timeElapsed",
  "timeRemaining",
  "totalChargedEnergy",
  "vehicleChargerState",
];

export function buildLiveSessionQuery(
  properties: readonly string[] = LIVE_SESSION_PROPERTIES,
): string {
  const fragment = properties
    .map((p) =>
      LIVE_SESSION_VALUE_RECORD_KEYS.has(p)
        ? `${p} { __typename value updatedAt }`
        : p,
    )
    .join(" ");
  return `query getLiveSessionData($vehicleId: ID!) { getLiveSessionData(vehicleId: $vehicleId) { __typename ${fragment} } }`;
}

/**
 * Live charging data pushed over the same WebSocket as vehicle state. This
 * replaces periodic getLiveSessionData polling while the socket is healthy.
 */
export const CHARGING_SESSION_SUBSCRIPTION = `subscription chargingSession($vehicleID: String!) { chargingSession(vehicleId: $vehicleID) { chartData { soc powerKW startTime endTime timeEstimationValidityStatus vehicleChargerState } liveData { powerKW kilometersChargedPerHour rangeAddedThisSession totalChargedEnergy timeElapsed timeRemaining price currency isFreeSession vehicleChargerState startTime } } }`;
