/**
 * GraphQL documents and field lists for the Rivian API.
 */

export const GRAPHQL_GATEWAY = 'https://rivian.com/api/gql/gateway/graphql';
export const GRAPHQL_CHARGING = 'https://rivian.com/api/gql/chrg/user/graphql';
export const GRAPHQL_WEBSOCKET = 'wss://api.rivian.com/gql-consumer-subscriptions/graphql';

export const APOLLO_CLIENT_NAME = 'com.rivian.ios.consumer-apollo-ios';
export const APOLLO_CLIENT_VERSION = '1.13.0-1494';

export const BASE_HEADERS = {
  'User-Agent': 'RivianApp/707 CFNetwork/1237 Darwin/20.4.0',
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'Apollographql-Client-Name': APOLLO_CLIENT_NAME,
} as const;

export const CREATE_CSRF_TOKEN = `mutation CreateCSRFToken { createCsrfToken { __typename csrfToken appSessionToken } }`;

export const LOGIN = `mutation Login($email: String!, $password: String!) { login(email: $email, password: $password) { __typename ... on MobileLoginResponse { __typename accessToken refreshToken userSessionToken } ... on MobileMFALoginResponse { __typename otpToken } } }`;

export const LOGIN_WITH_OTP = `mutation LoginWithOTP($email: String!, $otpCode: String!, $otpToken: String!) { loginWithOTP(email: $email, otpCode: $otpCode, otpToken: $otpToken) { __typename ... on MobileLoginResponse { __typename accessToken refreshToken userSessionToken } } }`;

export const GET_USER_INFO = `query getUserInfo { currentUser { __typename id vehicles { id vin name roles state createdAt updatedAt vehicle { __typename id vin modelYear make model vehicleState { supportedFeatures { __typename name status } } } } } }`;

/**
 * Build date and factory configuration. Its own query, so a field Rivian
 * drops or renames can't break getUserInfo and with it vehicle discovery.
 */
export const GET_VEHICLE_DETAILS = `query getVehicleDetails { currentUser { __typename vehicles { id vehicle { __typename actualGeneralAssemblyDate mobileConfiguration { trimOption { optionName } driveSystemOption { optionName } exteriorColorOption { optionName } interiorColorOption { optionName } wheelOption { optionName } tonneauOption { optionName } } } } } }`;

/**
 * Rivian's orders service. orderSnapshots exists only here: the gateway
 * answers GRAPHQL_VALIDATION_FAILED, which reads like "no orders". Host and
 * fields as verified against a live account by the MIT-licensed
 * rivian-order-view (github.com/MrSerious0/rivian-order-view).
 */
export const GRAPHQL_ORDERS = 'https://rivian.com/api/gql/orders/graphql/';

/**
 * The account's orders, including vehicles not yet delivered (which aren't
 * in currentUser.vehicles until Rivian provisions them). Only fields seen
 * answering a live account: one unknown field rejects the whole document.
 */
export const GET_ORDER_SNAPSHOTS = `query getOrderSnapshots { user { orderSnapshots(filterTypes: [PRE_ORDER, VEHICLE, RETAIL]) { id state configurationStatus fulfillmentSummaryStatus vehicleId vin } } }`;

/**
 * One order (orders service): the vehicle's build record and status, the
 * configured options and the estimated delivery window. A subset of
 * rivian-order-view's verified selection; money, payments and addresses are
 * deliberately not requested.
 */
export const GET_ORDER = `query order($id: String!) { order(id: $id) { id orderDate state type vin vehicleId configurationStatus fulfillmentSummaryStatus vehicle { vehicleId vin modelYear model make plannedBuildDate expectedBuildDate actualGeneralAssemblyDate expectedGeneralAssemblyStartDate status } payments { id amount status method type intent date } items { title type configuration { options { optionId optionName groupId } } } fulfillmentInfo { fulfillments { fulfillmentStatus estimatedDeliveryWindow { startDate endDate } } } } }`;

/**
 * An order's delivery appointment (gateway). Answers on the session headers
 * alone (seen live, Nov 2026), so no Bearer token is needed; rivian-order-view
 * sees it refused with an expired Bearer token. It still answers after
 * delivery, with the appointment that was kept.
 */
export const GET_DELIVERY = `query delivery($orderId: ID!) { delivery(orderId: $orderId) { status carrier vehicleVIN appointmentDetails { appointmentId startDateTime endDateTime timeZone } deliveryAddress { addressLine1 addressLine2 city state zipcode } } }`;

/** Renders of each ordered vehicle in its configuration, keyed by order id. */
export const GET_ORDER_IMAGES = `query getVehicleOrderImages($version: String) { getVehicleOrderMobileImages(version: $version) { orderId url resolution size design placement } }`;

/** Rendered images of each vehicle in its own paint and wheels, at every angle and resolution. Version 3 is the set the current app uses. */
export const GET_VEHICLE_IMAGES = `query getVehicleImages($version: String) { getVehicleMobileImages(version: $version) { vehicleId url resolution size design placement } }`;

/** Release-notes PDFs for the installed and pending software; the links are presigned and expire after an hour. */
export const GET_OTA_UPDATE_DETAILS = `query getOTAUpdateDetails($vehicleId: String!) { getVehicle(id: $vehicleId) { availableOTAUpdateDetails { url version locale } currentOTAUpdateDetails { url version locale } } }`;

export const GET_CHARGING_SCHEDULE = `query GetChargingSchedule($vehicleId: String!) { getVehicle(id: $vehicleId) { chargingSchedules { enabled startTime duration amperage location { latitude longitude } weekDays } } }`;

/** Parallax topics ("RVMs") as base64 protobuf; see parallax.ts. */
export const PARALLAX_MESSAGES_SUBSCRIPTION = `subscription ParallaxMessages($vehicleId: String!, $rvms: [String!]) { parallaxMessages(vehicleId: $vehicleId, rvms: $rvms) { payload timestamp rvm } }`;

/**
 * A departure's seat and wheel fields (in `surfaceHeatVentLevels`). Rivian's
 * schema has the same ones for every vehicle; those without a third row
 * send it as null.
 */
export const DEPARTURE_SURFACES = [
  'frontLeftSeat',
  'frontRightSeat',
  'rearLeftSeat',
  'rearRightSeat',
  'thirdRowLeftSeat',
  'thirdRowRightSeat',
  'steeringWheel',
];

/** Departure schedules are only exposed as a subscription. */
export const DEPARTURE_SCHEDULES_SUBSCRIPTION = `subscription vehicleDepartureSchedules($vehicleID: String!) { vehicleDepartureSchedules(vehicleId: $vehicleID) { id name isEnabled occurrence { __typename ... on RepeatsWeekly { days startsAtMin } } departureSettings { comfortSettings { surfaceHeatVentLevels { ${DEPARTURE_SURFACES.join(' ')} } cabinTempCelsius frontDefogDefrost } } } }`;

/** Account-wide completed charging sessions (charging gateway). */
export const GET_COMPLETED_SESSION_SUMMARIES = `query getCompletedSessionSummaries { getCompletedSessionSummaries { transactionId startInstant endInstant totalEnergyKwh rangeAddedKm vendor paidTotal chargerType currencyCode city vehicleId isPublic isHomeCharger } }`;

/** Power curve of the vehicle's most recent charging session (charging gateway). */
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
  'cloudConnection',
  'powerState',
  'chargerState',
  'chargerStatus',
  'timeToEndOfCharge',
  'batteryLevel',
  'batteryCapacity',
  'batteryLimit',
  'distanceToEmpty',
  'gnssLocation',
  'gnssSpeed',
  'gnssAltitude',
  'gnssBearing',
  'driveMode',
  'gearStatus',
  'vehicleMileage',
  'tirePressureStatusFrontLeft',
  'tirePressureStatusValidFrontLeft',
  'tirePressureStatusFrontRight',
  'tirePressureStatusValidFrontRight',
  'tirePressureStatusRearLeft',
  'tirePressureStatusValidRearLeft',
  'tirePressureStatusRearRight',
  'tirePressureStatusValidRearRight',
  'doorFrontLeftLocked',
  'doorFrontRightLocked',
  'doorRearLeftLocked',
  'doorRearRightLocked',
  'doorFrontLeftClosed',
  'doorFrontRightClosed',
  'doorRearLeftClosed',
  'doorRearRightClosed',
  'closureFrunkLocked',
  'closureFrunkClosed',
  'closureLiftgateLocked',
  'closureLiftgateClosed',
  'closureTailgateLocked',
  'closureTailgateClosed',
  'otaAvailableVersion',
  'batteryCellType',
  'otaCurrentVersion',
  'otaStatus',
  'otaCurrentStatus',
  'otaDownloadProgress',
  'otaInstallProgress',
  'otaInstallReady',
  'otaInstallDuration',
  'otaInstallType',
  'cabinClimateInteriorTemperature',
  'cabinClimateDriverTemperature',
  'batteryHvThermalEvent',
  'twelveVoltBatteryHealth',
  'chargePortState',
  'chargerDerateStatus',
  'cabinPreconditioningStatus',
  'cabinPreconditioningType',
  'petModeStatus',
  'petModeTemperatureStatus',
  'defrostDefogStatus',
  'steeringWheelHeat',
  'seatFrontLeftHeat',
  'seatFrontRightHeat',
  'seatRearLeftHeat',
  'seatRearRightHeat',
  'seatFrontLeftVent',
  'seatFrontRightVent',
  'closureTonneauLocked',
  'closureTonneauClosed',
  'closureSideBinLeftLocked',
  'closureSideBinLeftClosed',
  'closureSideBinRightLocked',
  'closureSideBinRightClosed',
  'windowFrontLeftClosed',
  'windowFrontRightClosed',
  'windowRearLeftClosed',
  'windowRearRightClosed',
  'gearGuardLocked',
  'gearGuardVideoStatus',
  'wiperFluidState',
  'brakeFluidLow',
  'alarmSoundStatus',
  'serviceMode',
];

/** Only valid on the WebSocket subscription — must NOT be polled. */
export const SUBSCRIPTION_ONLY_PROPERTIES: readonly string[] = [
  /** The active driver's name as the vehicle shows it. */
  'activeDriverName',
  'tirePressureFrontLeft',
  'tirePressureFrontRight',
  'tirePressureRearLeft',
  'tirePressureRearRight',
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
  'cloudConnection',
  'powerState',
  'gearStatus',
  'driveMode',
  'batteryLevel',
  'batteryLimit',
  'batteryCapacity',
  'distanceToEmpty',
  'vehicleMileage',
  'gnssLocation',
  'gnssSpeed',
  'chargerState',
  'chargerStatus',
  'chargePortState',
  'timeToEndOfCharge',
];

const PROPERTY_TEMPLATES: Record<string, string> = {
  cloudConnection: '{ lastSync isOnline }',
  gnssLocation: '{ latitude longitude timeStamp }',
};
const VALUE_TEMPLATE = '{ timeStamp value }';

export function buildVehicleStateFragment(properties: readonly string[]): string {
  return properties.map((p) => `${p} ${PROPERTY_TEMPLATES[p] ?? VALUE_TEMPLATE}`).join(' ');
}

export function buildVehicleStateQuery(properties: readonly string[]): string {
  return `query GetVehicleState($vehicleID: String!) { vehicleState(id: $vehicleID) { ${buildVehicleStateFragment(properties)} } }`;
}

export function buildVehicleStateSubscription(properties: readonly string[]): string {
  return `subscription VehicleState($vehicleID: String!) { vehicleState(id: $vehicleID) { ${buildVehicleStateFragment(properties)} } }`;
}

/**
 * Live charging data pushed over the same WebSocket as vehicle state.
 * (Rivian has removed the getLiveSessionData query; this is the only live
 * source.)
 */
export const CHARGING_SESSION_SUBSCRIPTION = `subscription chargingSession($vehicleID: String!) { chargingSession(vehicleId: $vehicleID) { chartData { soc powerKW startTime endTime timeEstimationValidityStatus vehicleChargerState } liveData { powerKW kilometersChargedPerHour rangeAddedThisSession totalChargedEnergy timeElapsed timeRemaining price currency isFreeSession vehicleChargerState startTime } } }`;
