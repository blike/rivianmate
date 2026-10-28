/**
 * REST API response shapes. The web app imports these types (types only —
 * erased at compile time) so both sides stay in sync.
 */
import type { RivianTrafficSnapshot } from './rivian/governor.js';
import type {
  ChargingSchedule,
  DepartureSchedule,
  LiveSessionData,
  VehicleState,
  VehicleView,
} from './rivian/types.js';
import type { FeedLatestData } from './rivian/subscription.js';
import type { SavedLocation } from './services/locations.js';
import type { MonitorDiagnostics } from './services/vehicle-monitor.js';

export type {
  ChargingSchedule,
  DepartureSchedule,
  FeedLatestData,
  LiveSessionData,
  VehicleState,
  VehicleView,
};

export interface SchedulesDto {
  /** null when not fetched yet or Rivian didn't provide it. */
  charging: ChargingSchedule[] | null;
  /**
   * `charging` is only Parallax's next window, as legacy had no schedules
   * (an R2): one day of the week, not the whole schedule.
   */
  chargingFromParallax: boolean;
  departures: DepartureSchedule[] | null;
  departuresUnavailable: boolean;
  chargingUpdatedAt: string | null;
  departuresUpdatedAt: string | null;
}

export interface StatusResponse {
  needsSetup: boolean;
  authed: boolean;
  rivianConnected: boolean;
  rivianAuthState: 'ok' | 'unauthenticated' | null;
  rivianEmail: string | null;
  mockMode: boolean;
  /** A TeslaMate database is set up, so its vehicles can be shown without Rivian. */
  teslamateConfigured: boolean;
  /** First-run setup still has to ask which outside lookups to allow. */
  needsLookupChoice: boolean;
  /** APP_PASSWORD set the password on first boot, so signing in is setup's first step. */
  signInStartsSetup: boolean;
}

export interface VersionResponse {
  /** Package version, e.g. "0.3.0". */
  version: string | null;
  /** Full git commit SHA the image was built from; null outside Docker builds. */
  commit: string | null;
}

export interface VehicleDto {
  id: string;
  vin: string;
  name: string | null;
  make: string | null;
  model: string | null;
  modelYear: number | null;
  /** Views of Rivian's render of this vehicle, served at `/api/vehicles/:id/render/:view`. */
  renders: VehicleView[];
  /** Where its data comes from: Rivian directly, or a TeslaMate database (read-only). */
  source: 'rivian' | 'teslamate';
}

export type { ChargingSettings, SavedLocation } from './services/locations.js';

/** A saved location as created or edited; the server assigns the id. */
export type SavedLocationInput = Omit<SavedLocation, 'id'>;

/** An address search result, for placing a location on the map. */
export interface GeocodeResultDto {
  label: string;
  lat: number;
  lon: number;
}

export interface UnitPreferences {
  distance: 'mi' | 'km';
  temperature: 'F' | 'C';
}

/** Which outside services finished drives are sent to. */
export interface LookupSettings {
  /** Start and end addresses, from OpenStreetMap's Nominatim. */
  addresses: boolean;
  /** The weather along the route, from Open-Meteo. */
  weather: boolean;
}

export interface RivianDiagnosticsResponse {
  monitor: MonitorDiagnostics;
  traffic: RivianTrafficSnapshot;
}

export interface ConnectResponse {
  ok: boolean;
  otpRequired?: boolean;
}

export interface HistoryPoint {
  bucket: string;
  avg: number | null;
  min: number | null;
  max: number | null;
}

/** What the vehicle was doing: the first that applies of updating, driving, charging, asleep, else awake. */
export interface StateSpanDto {
  state: 'driving' | 'charging' | 'updating' | 'awake' | 'asleep';
  from: string;
  to: string;
}

/** Plugged in, split into time spent charging and time just connected. */
export interface ChargeSpanDto {
  kind: 'charging' | 'plugged';
  from: string;
  to: string;
}

export type HistoryMetric = 'battery' | 'range' | 'mileage';

export interface LocationPointDto {
  ts: string;
  lat: number;
  lon: number;
  speedKmh: number | null;
  bearing: number | null;
  altitude: number | null;
  /** The drive it was recorded on, where known; null while parked. */
  driveId?: number | null;
}

/**
 * While a drive is in progress (endedAt null), the end figures (distance,
 * end battery and range, energy) are its readings so far.
 */
export interface DriveDto {
  id: number;
  startedAt: string;
  endedAt: string | null;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  distanceKm: number | null;
  startBattery: number | null;
  endBattery: number | null;
  /** Battery-% drop × reported pack capacity; null when not computable. */
  energyKwh: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
  /** Vehicle's range estimate at the start and end (now, while in progress). */
  startRangeKm: number | null;
  endRangeKm: number | null;
  maxSpeedKmh: number | null;
  /** Average outside temperature along the route (°C), from weather model data; null until the drive ends. */
  outsideTempC: number | null;
  /** The weather over the drive, looked up once it ends; null until then or without data. */
  weather: DriveWeatherDto | null;
  driveMode: string | null;
  /** Where navigation was headed, if the vehicle was navigating. */
  destination: { name: string | null; lat: number; lon: number } | null;
  /** Where it started and ended: a saved location's name, or an address once looked up. */
  start: DrivePlaceDto | null;
  end: DrivePlaceDto | null;
}

/**
 * When RivianMate's drive history starts. Charging history imported from
 * Rivian can reach back further, so totals that set the two against each
 * other start here.
 */
export interface DriveCoverageDto {
  since: string | null;
}

export interface DrivePlaceDto {
  /** A saved location's name ("Work"), "Home", or a short address, e.g. "306 West Willow Street, Normal". */
  label: string;
  /** Full address, when looked up. */
  address: string | null;
  isHome: boolean;
  /** The saved location, when the place is one. */
  locationId: number | null;
  /** Neither saved nor looked up (address lookups off): the label is the coordinates. */
  unnamed: boolean;
}

export interface DriveWeatherDto {
  /** Lowest and highest outside temperature along the route (°C). */
  minC: number;
  maxC: number;
  /**
   * WMO weather code for the drive: the commonest, unless it was wet for a good part of it.
   * 0 clear, 1–3 cloud, 45 fog, 51–67 drizzle/rain, 71–77 snow, 80–99 showers/storms.
   */
  weatherCode: number | null;
  /** Average wind at 10 m (km/h), and where it mostly blew from (degrees). */
  windKmh: number | null;
  windFromDeg: number | null;
}

export interface DriveDetailDto extends DriveDto {
  points: LocationPointDto[];
}

export interface OtaTimelineDto {
  current: string | null;
  available: string | null;
  /**
   * Installed versions, newest first; firstSeen is when RivianMate first saw
   * it. hasNotes is true once its release notes are saved.
   */
  versions: { version: string; firstSeen: string; hasNotes: boolean }[];
}

/** Average tire pressures per time bucket, in bar. */
export interface TirePressurePointDto {
  ts: string;
  frontLeft: number | null;
  frontRight: number | null;
  rearLeft: number | null;
  rearRight: number | null;
}

export interface PhantomDrainDto {
  days: { day: string; lossPct: number; parkedHours: number; pctPerDay: number }[];
  /** Average %/day over all parked time in the window; null if too little data. */
  avgPctPerDay: number | null;
}

/**
 * The battery over a window: its level at each end, and what it lost while
 * parked and unplugged (net of each parked stretch, as phantom drain counts
 * it). Levels in percent; capacity is the latest reported.
 */
export interface BatteryWindowDto {
  capacityKwh: number | null;
  startLevel: number | null;
  endLevel: number | null;
  parkedLossPct: number;
  parkedHours: number;
}

export interface BatteryHealthDto {
  /** Newest valid capacity reading from the vehicle. */
  latest: { kwh: number; at: string } | null;
  /** Last recorded vehicle reading per UTC day, not a daily maximum. */
  reported: { day: string; at: string; kwh: number }[];
  /** Rated pack capacity from Parallax battery_characteristics field 6. */
  ratedCapacity: { kwh: number; at: string } | null;
}

/** The fitted wheel set's rotation reminder, from Parallax vehicle_wheels; distances in km. */
export interface TireRotationDto {
  odometerAtLastRotationKm: number;
  /** 0 when the reminder is off. */
  intervalKm: number;
  /** The vehicle's odometer now; null when it hasn't reported one. */
  odometerKm: number | null;
  /** When the reading arrived. */
  at: string;
}

export interface ChargingCurvePointDto {
  ts: string;
  powerKw: number | null;
  soc: number | null;
  /** The vehicle's forecast for a charge in progress, not a reading. */
  projected?: boolean;
  /**
   * With `projected`: the app's own estimate, from the time left and the
   * charge limit, as Rivian sent no forecast.
   */
  estimated?: boolean;
}

export interface ChargingSessionDto {
  id: number;
  vehicleId: string;
  startedAt: string;
  endedAt: string | null;
  chargerId: string | null;
  chargerType: string | null;
  startSoc: number | null;
  endSoc: number | null;
  /**
   * startedAt → endedAt spans the plug-in. Within it, seconds spent charging
   * (null when unknown), not counting a stretch running since `chargingSince`.
   */
  chargingSeconds: number | null;
  chargingSince: string | null;
  /**
   * First and last moment it was charging within the plug-in, from recorded
   * charger status; null when that wasn't recorded (e.g. imported sessions).
   * A charge still running ends at the latest status reading.
   */
  chargingStartedAt: string | null;
  chargingEndedAt: string | null;
  energyKwh: number | null;
  /** Rivian's split of the energy: stored in the pack vs heating/cooling it. */
  packKwh: number | null;
  thermalKwh: number | null;
  /**
   * Drawn from the charger but not added to the battery, from TeslaMate's
   * AC sessions; it can't tell heating from conversion losses, so it isn't
   * part of `thermalKwh`.
   */
  lossKwh: number | null;
  rangeAddedKm: number | null;
  avgPowerKw: number | null;
  maxPowerKw: number | null;
  cost: string | null;
  currency: string | null;
  lat: number | null;
  lon: number | null;
  /** Charged at home (Rivian's flag, home wallbox, or a home location). */
  isHome: boolean;
  /** The saved location the session was at, if any. */
  location: { id: number; name: string; isHome: boolean } | null;
  /** Energy × the location's rate, when the session has no cost of its own. */
  estimatedCost: string | null;
  /**
   * Until Rivian reports `energyKwh` (often only after unplugging), the
   * energy the battery gained, from its levels and the pack's capacity.
   */
  estimatedEnergyKwh: number | null;
  /** The charge limit when it ended (or now, while it's under way), from recorded state. */
  socLimit: number | null;
  /**
   * live = recorded by RivianMate; rivian = imported from Rivian's history;
   * teslamate = read from TeslaMate.
   */
  source: 'live' | 'rivian' | 'live+rivian' | 'teslamate';
  vendor: string | null;
  city: string | null;
  isPublic: boolean | null;
}

export interface WallboxDto {
  wallboxId: string;
  name: string | null;
  model: string | null;
  serialNumber: string | null;
  softwareVersion: string | null;
  maxAmps: number | null;
  maxPower: number | null;
  latitude: number | null;
  longitude: number | null;
  latest: {
    ts: string;
    chargingStatus: string | null;
    power: number | null;
    currentVoltage: number | null;
    currentAmps: number | null;
  } | null;
}

/**
 * Latest readings from Rivian's Parallax feed; each part is null until the
 * vehicle has reported it. `at` is when Rivian sent it.
 */
export interface VehicleInsightsDto {
  /** Last cell temperatures reported (°C); only sent while awake. */
  cellTemps: { avgC: number; maxC: number; minC: number; at: string } | null;
  /** Whether the latest battery report carried temperatures (vehicle awake). */
  cellTempsCurrent: boolean;
  coldWeather: {
    usableSoc: number | null;
    coldSoc: number;
    rangeImpactKm: number;
    at: string;
  } | null;
  /** Energy used while parked, over Rivian's windows (e.g. last 24 h). */
  parkedEnergy: {
    windows: {
      minutes: number;
      kwh: number;
      rangeKm: number;
      /** Null where the source doesn't split it by use (TeslaMate). */
      uses: { climate: number; system: number; gearGuard: number; outlets: number } | null;
    }[];
    at: string;
  } | null;
  /** The vehicle's active navigation; null when it isn't navigating. */
  navigation: {
    destination: { name: string | null; lat: number; lon: number };
    totalDistanceKm: number | null;
    totalDurationS: number | null;
    arrivalSoc: number | null;
    arrivalRangeKm: number | null;
    etaAt: string | null;
    /** The planned route from where it was last calculated, as [lat, lon] points. */
    route: [number, number][] | null;
    remainingKm: number | null;
    remainingS: number | null;
    at: string;
  } | null;
  connectivity: {
    wifi: { ssid: string; rssiDbm: number | null; frequencyMhz: number | null } | null;
    cellular: { carrier: string | null; technology: string | null } | null;
    at: string;
  } | null;
}

/** A timed alert: fires once the condition has lasted `minutes`. */
export interface TimedAlertSettings {
  enabled: boolean;
  minutes: number;
  /** Skip while the vehicle is at home. */
  awayOnly: boolean;
}

export interface NotificationEvents {
  doorOpen: TimedAlertSettings;
  windowOpen: TimedAlertSettings;
  unlocked: TimedAlertSettings;
  tirePressure: { enabled: boolean };
  updateAvailable: { enabled: boolean };
  updateInstalled: { enabled: boolean };
  updateFailed: { enabled: boolean };
  chargingComplete: { enabled: boolean };
  lowBattery: { enabled: boolean; percent: number };
}

export type NotificationChannelKind = 'apprise' | 'discord';

/** A saved destination; the URL itself isn't sent back, since it holds a secret. */
export interface NotificationDestinationDto {
  id: string;
  kind: NotificationChannelKind;
  /** The user's label, e.g. "Family Discord"; null shows the service name. */
  name: string | null;
  /** Enough of the URL to recognize it, e.g. "apprise:8000/notify/…". */
  preview: string;
}

export interface NotificationSettingsDto {
  enabled: boolean;
  destinations: NotificationDestinationDto[];
  /** Where RivianMate is reached, for links in alerts (e.g. release notes). */
  appUrl: string | null;
  events: NotificationEvents;
  /** Whether a home location or wallbox is known, for "not at home" alerts. */
  homeKnown: boolean;
}

/**
 * The full destination list: an `id` without a `url` keeps that saved
 * destination (renamed if `name` changed); a `url` sets a new one. Saved
 * destinations left out are removed.
 */
export interface NotificationDestinationUpdate {
  id?: string;
  kind: NotificationChannelKind;
  name: string | null;
  url?: string;
}

export interface NotificationSettingsUpdate {
  enabled: boolean;
  destinations: NotificationDestinationUpdate[];
  appUrl: string | null;
  events: NotificationEvents;
}

export interface NotificationTestResult {
  id: string;
  kind: NotificationChannelKind;
  name: string | null;
  ok: boolean;
  error: string | null;
}

export type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** One server log line, as shown in Settings → Logs. */
export interface LogEntryDto {
  /** Increases by one per line since startup. */
  seq: number;
  time: string;
  level: LogLevelName;
  component: string | null;
  msg: string;
  /** Everything else logged with the line (status, ms, err...). */
  fields?: Record<string, unknown>;
}

/** First message on the log stream. */
export interface LogBacklogDto {
  /** The server's LOG_LEVEL: lines below it were never recorded. */
  level: string;
  entries: LogEntryDto[];
}

/** The TeslaMate database RivianMate reads from; the URL itself isn't sent back. */
export interface TeslaMateSettingsDto {
  configured: boolean;
  /** The connection without its password, e.g. "postgres://teslamate@nas:5432/teslamate". */
  preview: string | null;
  /** Whether the last read from TeslaMate worked. */
  connected: boolean;
  error: string | null;
  lastReadAt: string | null;
  vehicles: VehicleDto[];
}

export interface TeslaMateSettingsUpdate {
  /** A Postgres connection URL for TeslaMate's database. */
  url: string;
}
