import type { RivianApi } from './client.js';
import type {
  ChargingSessionCallback,
  DepartureSchedulesCallback,
  ParallaxCallback,
  VehicleStateCallback,
  VehicleStateStream,
} from './subscription.js';
import {
  ChargeSessionSummary,
  ChargingSchedule,
  LiveSessionData,
  LoginResult,
  OtaUpdateDetails,
  RivianInvalidOtpError,
  RivianTokens,
  TimeStampedValue,
  UserInfo,
  VehicleDetails,
  VehicleImageUrls,
  VehicleState,
  Wallbox,
} from './types.js';
import {
  RVM_BATTERY_STATE,
  RVM_CHARGE_BREAKDOWN,
  RVM_COLD_WEATHER,
  PARALLAX_FEATURE_FLAG,
  RVM_GNSS,
  RVM_NETWORK,
  RVM_PARKED_ENERGY,
  RVM_TIRES,
  RVM_TRIP_INFO,
  RVM_TRIP_PROGRESS,
  type ParallaxGroup,
  groupOf,
  rvmDef,
} from './parallax/index.js';
import { b64, double, float, int, message, string } from './parallax/encode.js';
import { ROUTE_HOME } from './mock-route-home.js';

/** Made-up addresses for mock drives (no real lookups in mock mode). */
export const mockGeocode = async (lat: number, lon: number) => {
  const number = 100 + (Math.round(Math.abs(lat * lon) * 1000) % 900);
  return {
    place: `${number} Prairie Road, Normal`,
    address: `${number} Prairie Road, Normal, Illinois, United States`,
  };
};

export const MOCK_VIN = '7FCTGAAA0MN000001';
export const MOCK_VEHICLE_ID = 'mock-vehicle-1';
export const MOCK_OTP = '000000';

const TICK_MS = 2_000;

/** Home (and the wallbox) on a residential street in Normal, IL. */
const HOME = { lat: 40.53694, lon: -88.98001 };

/** A 2.2 km loop around the neighborhood, starting and ending at home. */
const LOOP: [number, number][] = [
  [40.53694, -88.98001],
  [40.53689, -88.98246],
  [40.53675, -88.98263],
  [40.53613, -88.98262],
  [40.53536, -88.9826],
  [40.5346, -88.98256],
  [40.53382, -88.98255],
  [40.53386, -88.9806],
  [40.53315, -88.98049],
  [40.53239, -88.98047],
  [40.53224, -88.98042],
  [40.53183, -88.9804],
  [40.53176, -88.97927],
  [40.53178, -88.97826],
  [40.53179, -88.97752],
  [40.53189, -88.97739],
  [40.53239, -88.97741],
  [40.53282, -88.97742],
  [40.53299, -88.9774],
  [40.53317, -88.97736],
  [40.53343, -88.97727],
  [40.5336, -88.97719],
  [40.53375, -88.97708],
  [40.53391, -88.97696],
  [40.53408, -88.97679],
  [40.53422, -88.97663],
  [40.53433, -88.97646],
  [40.53445, -88.97625],
  [40.53454, -88.97606],
  [40.53462, -88.97585],
  [40.53476, -88.97578],
  [40.53494, -88.97585],
  [40.53703, -88.9759],
  [40.53701, -88.97704],
  [40.53699, -88.97799],
  [40.53694, -88.98001],
];

const toRad = (deg: number) => (deg * Math.PI) / 180;

function distanceM(a: [number, number], b: [number, number]): number {
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(h));
}

function bearingDeg(a: [number, number], b: [number, number]): number {
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x =
    Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) -
    Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** A drive's path, with the distance (m) at each vertex and how many ticks it takes. */
interface MockRoute {
  points: [number, number][];
  at: number[];
  lengthM: number;
  driveTicks: number;
}

function mockRoute(points: [number, number][], ticks: (lengthM: number) => number): MockRoute {
  const at = points.reduce<number[]>((acc, p, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1]! + distanceM(points[i - 1]!, p));
    return acc;
  }, []);
  const lengthM = at[at.length - 1]!;
  return { points, at, lengthM, driveTicks: ticks(lengthM) };
}

/** Around the loop at ~40 km/h. */
const LOOP_ROUTE = mockRoute(LOOP, () => 100);
/** Home from Lexington at 90 km/h (25 m/s). */
const HOME_ROUTE = mockRoute(ROUTE_HOME, (m) => Math.round(m / (25 * (TICK_MS / 1000))));

/** [lat, lon] points in Google's encoded polyline format, as navigation sends routes. */
function encodePolyline(points: [number, number][]): string {
  let out = '';
  let prev = [0, 0];
  for (const point of points) {
    const next = point.map((x) => Math.round(x * 1e5));
    for (const [i, value] of next.entries()) {
      let v = value - prev[i]!;
      v = v < 0 ? ~(v << 1) : v << 1;
      while (v >= 0x20) {
        out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>= 5;
      }
      out += String.fromCharCode(v + 63);
    }
    prev = next;
  }
  return out;
}

/** Position and heading a given distance along a route. */
function alongRoute(route: MockRoute, m: number): { lat: number; lon: number; heading: number } {
  const { points, at } = route;
  let i = 1;
  while (i < points.length - 1 && at[i]! < m) i++;
  const a = points[i - 1]!;
  const b = points[i]!;
  const span = at[i]! - at[i - 1]!;
  const f = span > 0 ? Math.min(1, Math.max(0, (m - at[i - 1]!) / span)) : 0;
  return {
    lat: a[0] + (b[0] - a[0]) * f,
    lon: a[1] + (b[1] - a[1]) * f,
    heading: bearingDeg(a, b),
  };
}

/** Usable kWh per 1% of battery, and consumption around town. */
const KWH_PER_PCT = 1.3;
const KWH_PER_KM = 0.35;

type Phase = 'parked' | 'driving' | 'arriving' | 'charging';

/**
 * Ticks per phase: park 10 → drive (the route's ticks; 100 around the
 * loop) → park 100 → charge 60 → repeat. The stop after a drive (200 s)
 * outlasts the drive detector's 3-minute park grace, so mock drives
 * actually complete.
 */
const PHASE_TICKS: Record<Exclude<Phase, 'driving'>, number> = {
  parked: 10,
  arriving: 100,
  charging: 60,
};

/** Rolling hills, so elevation features have something to show. */
const altitudeAt = (tick: number) => Math.round(240 + 35 * Math.sin(tick / 8));

/** Demo scenes the mock can start in instead of parked at home (MOCK_SCENE). */
export type MockScene = 'drive-home';

/** The drive-home scene: this far along the drive home, which began at this battery level. */
const DRIVE_HOME = { fraction: 0.6, startBattery: 66 };
const START_MILEAGE_M = 12_345_678;

const usedPct = (m: number) => ((m / 1000) * KWH_PER_KM) / KWH_PER_PCT;

/**
 * The drive-home scene's drive up to where the mock picks it up, one
 * reading per tick and the last at `endMs`, for recording it ahead of time
 * (scripts/demo-scene.ts) so the scene needn't be driven first.
 */
export function driveHomeSoFar(endMs: number) {
  const route = HOME_ROUTE;
  const ticks = Math.round(DRIVE_HOME.fraction * route.driveTicks);
  const stepM = route.lengthM / route.driveTicks;
  const points = Array.from({ length: ticks + 1 }, (_, tick) => {
    const at = alongRoute(route, tick * stepM);
    return {
      ts: new Date(endMs - (ticks - tick) * TICK_MS),
      lat: at.lat,
      lon: at.lon,
      speedKmh: tick === 0 ? 0 : (stepM / (TICK_MS / 1000)) * 3.6,
      bearing: Math.round(at.heading),
      altitude: altitudeAt(tick),
    };
  });
  return {
    startedAt: points[0]!.ts,
    startBattery: DRIVE_HOME.startBattery,
    startMileageM: START_MILEAGE_M,
    batteryCapacityKwh: 135,
    destination: { name: 'Home', ...HOME },
    points,
  };
}

const PHASE_ORDER: Phase[] = ['parked', 'driving', 'arriving', 'charging'];

function ts(): string {
  return new Date().toISOString();
}

function v(value: string | number): TimeStampedValue {
  return { timeStamp: ts(), value };
}

/**
 * Simulated Rivian cloud: same interface as the real client plus a state
 * stream that walks a park → drive → park → charge loop.
 */
export class MockRivian implements RivianApi, VehicleStateStream {
  tokens: RivianTokens | undefined;
  readonly appSession = undefined;
  onAuthFailure?: () => void;
  onAuthenticated?: () => void;
  onConnectionChange?: (connected: boolean) => void;

  private callback?: VehicleStateCallback;
  private chargingCallback?: ChargingSessionCallback;
  private parallaxCallbacks = new Map<ParallaxGroup, ParallaxCallback>();
  private subscribedId = MOCK_VEHICLE_ID;
  private timer?: NodeJS.Timeout;
  private phase: Phase = 'parked';
  private tickInPhase = 0;
  private route = LOOP_ROUTE;

  private lat = HOME.lat;
  private lon = HOME.lon;
  private heading = 270;
  private battery = 79;
  private mileageM = START_MILEAGE_M;
  private sessionEnergyKwh = 0;
  private sessionStart?: string;
  private sessionStartSoc = 0;

  constructor(options: { scene?: MockScene } = {}) {
    if (options.scene === 'drive-home') {
      // Partway home, where driveHomeSoFar leaves off.
      this.route = HOME_ROUTE;
      this.phase = 'driving';
      this.tickInPhase = Math.round(DRIVE_HOME.fraction * HOME_ROUTE.driveTicks);
      const at = alongRoute(this.route, this.drivenM());
      this.lat = at.lat;
      this.lon = at.lon;
      this.heading = at.heading;
      this.battery = DRIVE_HOME.startBattery - usedPct(this.drivenM());
      this.mileageM = START_MILEAGE_M + this.drivenM();
    }
  }

  get userSessionToken(): string | undefined {
    return this.tokens?.userSessionToken;
  }

  async createCsrfToken(): Promise<void> {}

  async refreshSession(): Promise<void> {}

  async login(_email: string, _password: string): Promise<LoginResult> {
    return { kind: 'otp', otpToken: 'mock-otp-token' };
  }

  async loginWithOtp(_email: string, otpCode: string, _otpToken?: string): Promise<RivianTokens> {
    if (otpCode !== MOCK_OTP) {
      throw new RivianInvalidOtpError('Invalid OTP (mock expects 000000)');
    }
    this.tokens = {
      accessToken: 'mock-access',
      refreshToken: 'mock-refresh',
      userSessionToken: 'mock-usess',
    };
    return this.tokens;
  }

  async getUserInfo(): Promise<UserInfo> {
    return {
      id: 'mock-user-1',
      vehicles: [
        {
          id: MOCK_VEHICLE_ID,
          vin: MOCK_VIN,
          name: 'Mock R1S',
          roles: ['owner'],
          state: 'ACTIVE',
          vehicle: {
            id: MOCK_VEHICLE_ID,
            vin: MOCK_VIN,
            modelYear: 2023,
            make: 'RIVIAN',
            model: 'R1S',
            vehicleState: {
              supportedFeatures: [
                { name: 'LIFTGATE_CMD', status: 'AVAILABLE' },
                { name: PARALLAX_FEATURE_FLAG, status: 'AVAILABLE' },
              ],
            },
          },
        },
      ],
    };
  }

  async getVehicleDetails(): Promise<Record<string, VehicleDetails>> {
    return {
      [MOCK_VEHICLE_ID]: {
        builtOn: '2023-03-14',
        trim: 'R1S Adventure',
        driveSystem: 'Quad-motor AWD',
        exteriorColor: 'Forest Green paint',
        interiorColor: 'Ocean Coast + Brown Ash Wood',
        wheels: '21" Road Dark',
        tonneau: null,
      },
    };
  }

  async getVehicleImageUrls(): Promise<Record<string, VehicleImageUrls>> {
    return {};
  }

  async getVehicleState(_vin: string): Promise<VehicleState> {
    return this.fullState();
  }

  async getLiveSessionData(_vin: string): Promise<LiveSessionData | null> {
    if (this.phase !== 'charging') return null;
    const now = ts();
    return {
      chargerId: 'mock-wallbox-1',
      currentCurrency: 'USD',
      currentPrice: Number((this.sessionEnergyKwh * 0.14).toFixed(2)),
      isFreeSession: false,
      isRivianCharger: false,
      locationId: 'home',
      startTime: this.sessionStart ?? now,
      timeElapsed: this.tickInPhase * (TICK_MS / 1000),
      kilometersChargedPerHour: { value: 35, updatedAt: now },
      power: { value: 11.5, updatedAt: now },
      rangeAddedThisSession: {
        value: Number((this.sessionEnergyKwh * 3.4).toFixed(1)),
        updatedAt: now,
      },
      soc: { value: Number(this.battery.toFixed(1)), updatedAt: now },
      timeRemaining: {
        value: (PHASE_TICKS.charging - this.tickInPhase) * (TICK_MS / 1000),
        updatedAt: now,
      },
      totalChargedEnergy: {
        value: Number(this.sessionEnergyKwh.toFixed(2)),
        updatedAt: now,
      },
      vehicleChargerState: { value: 'charging_active', updatedAt: now },
      socLimit: { value: 85, updatedAt: now },
    };
  }

  async getRegisteredWallboxes(): Promise<Wallbox[]> {
    const charging = this.phase === 'charging';
    return [
      {
        wallboxId: 'mock-wallbox-1',
        userId: 'mock-user-1',
        wifiId: 'home-wifi',
        name: 'Garage Wall Charger',
        linked: true,
        latitude: HOME.lat,
        longitude: HOME.lon,
        chargingStatus: charging ? 'charging' : 'standby',
        power: charging ? 11.5 : 0,
        currentVoltage: charging ? 240 : 0,
        currentAmps: charging ? 48 : 0,
        softwareVersion: '1.2.3',
        model: 'W48-01-US',
        serialNumber: 'MOCKWB0001',
        maxAmps: 48,
        maxVoltage: 240,
        maxPower: 11.5,
      },
    ];
  }

  async getChargeHistory(): Promise<ChargeSessionSummary[]> {
    // Fixed UTC hours, so the sessions land at the same local time each run.
    const midnight = new Date().setUTCHours(0, 0, 0, 0);
    const at = (daysAgo: number, utcHour: number) =>
      new Date(midnight - daysAgo * 86_400_000 + utcHour * 3_600_000).toISOString();
    const base = { vehicleId: MOCK_VEHICLE_ID, chargerType: null };
    return [
      {
        ...base,
        transactionId: 'mock-tx-1',
        startInstant: at(12, 16),
        endInstant: at(12, 17.6),
        totalEnergyKwh: 19.2,
        rangeAddedKm: 65,
        vendor: 'RIVIAN',
        paidTotal: 6.14,
        currencyCode: 'USD',
        city: 'Normal',
        isPublic: true,
        isHomeCharger: false,
      },
      {
        ...base,
        transactionId: 'mock-tx-2',
        startInstant: at(6, 15.25),
        endInstant: at(6, 15.85),
        totalEnergyKwh: 55.9,
        rangeAddedKm: 182,
        vendor: 'Electrify America',
        paidTotal: 31.3,
        currencyCode: 'USD',
        city: 'Champaign',
        isPublic: true,
        isHomeCharger: false,
      },
      {
        ...base,
        transactionId: 'mock-tx-3',
        startInstant: at(3, 1),
        endInstant: at(3, 12),
        totalEnergyKwh: 44.3,
        rangeAddedKm: 144,
        vendor: null,
        paidTotal: null,
        currencyCode: null,
        city: null,
        isPublic: false,
        isHomeCharger: true,
      },
    ];
  }

  async getChargingSchedules(_vehicleId: string): Promise<ChargingSchedule[]> {
    return [
      {
        // Rivian also returns schedules that are switched off.
        enabled: false,
        startTime: 0,
        duration: 24 * 60,
        amperage: 48,
        weekDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        location: { latitude: HOME.lat, longitude: HOME.lon },
      },
      {
        enabled: true,
        startTime: 23 * 60,
        duration: 7 * 60,
        amperage: 48,
        weekDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        location: { latitude: HOME.lat, longitude: HOME.lon },
      },
    ];
  }

  subscribeDepartureSchedules(vehicleId: string, callback: DepartureSchedulesCallback): void {
    callback(vehicleId, [
      {
        id: 'mock-departure-1',
        name: 'Work',
        enabled: true,
        occurrence: {
          type: 'weekly',
          weekDays: ['Monday', 'Wednesday', 'Friday'],
          timeOfDayMinutes: 7 * 60 + 30,
        },
        comfortSettings: {
          surfaces: { frontLeftSeat: 'Heat2', frontRightSeat: 'Off', steeringWheel: 'On' },
          cabinClimateSetTemp: 21,
          defrost: false,
        },
      },
    ]);
  }

  async getOtaUpdateDetails(_vehicleId: string): Promise<OtaUpdateDetails> {
    const notes = (version: string) => ({
      url: `https://example.com/rivian-release-notes/${version}.pdf`,
      version,
      locale: 'en-US',
    });
    return { current: notes('2026.34.1'), available: notes('2026.36.2') };
  }

  // --- VehicleStateStream ---

  subscribe(vehicleId: string, callback: VehicleStateCallback): void {
    this.subscribedId = vehicleId;
    this.callback = callback;
  }

  subscribeCharging(_vin: string, callback: ChargingSessionCallback): void {
    this.chargingCallback = callback;
  }

  subscribeParallax(
    _vehicleId: string,
    _rvms: readonly string[],
    callback: ParallaxCallback,
    group: ParallaxGroup = 'core',
  ): void {
    this.parallaxCallbacks.set(group, callback);
  }

  start(): void {
    if (this.timer) return;
    this.onConnectionChange?.(true);
    this.onAuthenticated?.();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.emit(this.fullState());
    this.emitParallax(RVM_COLD_WEATHER, [...int(1, 85), ...int(2, 6), ...int(3, 24)]);
    // Uses: 2 climate, 3 outlets, 4 system, 5 Gear Guard (see decodeParkedEnergy).
    this.emitParallax(RVM_PARKED_ENERGY, [
      ...message(1, [
        ...float(1, 1.3),
        ...float(2, 0.45),
        ...float(3, 0.1),
        ...float(4, 0.5),
        ...float(5, 0.25),
        ...float(6, 5.9),
        ...int(11, 1440),
      ]),
      ...message(2, [
        ...float(1, 0.4),
        ...float(2, 0.08),
        ...float(4, 0.2),
        ...float(5, 0.12),
        ...float(6, 1.8),
        ...int(11, 480),
      ]),
    ]);
    this.emitParallax(RVM_NETWORK, [
      ...message(4, [...string(3, 'Garage'), ...int(8, -58), ...int(10, 5180)]),
      ...message(5, [...string(1, 'AT&T'), ...string(2, 'LTE')]),
    ]);
    this.emitBatteryState();
    this.emitGnss();
    if (this.phase === 'driving') this.emitTripInfo();
    const tire = (pos: number, bar: number) =>
      message(2, [...int(1, pos), ...int(2, 1), ...double(3, bar)]);
    this.emitParallax(RVM_TIRES, [
      ...tire(1, 2.8),
      ...tire(2, 2.85),
      ...tire(3, 2.75),
      ...tire(4, 2.8),
    ]);
  }

  /** Parallax topics come in as base64 protobuf, as from Rivian, on their group's subscription. */
  private emitParallax(rvm: string, bytes: number[]): void {
    const def = rvmDef(rvm);
    const callback = this.parallaxCallbacks.get(def ? groupOf(def) : 'core');
    callback?.(this.subscribedId, { rvm, payload: b64(bytes), timestamp: Date.now() });
  }

  private emitGnss(): void {
    const driving = this.phase === 'driving';
    this.emitParallax(RVM_GNSS, [
      ...double(1, this.lat),
      ...double(2, this.lon),
      ...double(3, driving ? altitudeAt(this.tickInPhase) : 240),
      // Speed is left out at a standstill, as the vehicle sends it.
      ...(driving ? float(4, this.speedMps()) : []),
      ...float(5, this.heading > 180 ? this.heading - 360 : this.heading),
    ]);
  }

  /** Navigating home along the route, laid out as the vehicle sends it. */
  private emitTripInfo(): void {
    const km = this.route.lengthM / 1000;
    const seconds = this.route.driveTicks * (TICK_MS / 1000);
    const secondsLeft = (this.route.driveTicks - this.tickInPhase) * (TICK_MS / 1000);
    const arrivalS = Math.round(Date.now() / 1000 + secondsLeft);
    // Range is 4.4 km per %.
    const arrivalSoc = Math.max(5, this.battery - usedPct(this.route.lengthM - this.drivenM()));
    this.emitParallax(RVM_TRIP_INFO, [
      ...string(1, 'mock-trip'),
      ...message(3, [
        ...double(1, km * 1000),
        ...double(2, seconds),
        ...message(
          3,
          message(1, [
            ...message(1, [...double(1, HOME.lat), ...double(2, HOME.lon)]),
            ...string(4, 'Home'),
            ...message(9, int(1, arrivalS)),
          ]),
        ),
        ...double(6, arrivalSoc),
        ...double(7, arrivalSoc * 4.4 * 1000),
        ...string(10, encodePolyline(this.route.points)),
      ]),
      ...double(5, this.battery + usedPct(this.drivenM())),
      ...message(6, int(1, arrivalS)),
    ]);
  }

  private emitTripProgress(): void {
    const ticksLeft = this.route.driveTicks - this.tickInPhase;
    const secondsLeft = ticksLeft * (TICK_MS / 1000);
    this.emitParallax(RVM_TRIP_PROGRESS, [
      ...message(1, int(1, Math.round(Date.now() / 1000 + secondsLeft))),
      ...double(4, this.route.lengthM - this.drivenM()),
      ...double(5, secondsLeft),
    ]);
  }

  private emitBatteryState(): void {
    const warm = this.phase === 'charging' ? 6 * Math.min(1, this.tickInPhase / 30) : 0;
    this.emitParallax(RVM_BATTERY_STATE, [
      ...message(1, [...double(1, Number(this.battery.toFixed(1))), ...double(2, 135)]),
      ...message(2, [...float(1, 24 + warm), ...float(2, 27 + warm), ...float(3, 22 + warm)]),
    ]);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.onConnectionChange?.(false);
  }

  private tick(): void {
    this.tickInPhase += 1;
    const phaseTicks = this.phase === 'driving' ? this.route.driveTicks : PHASE_TICKS[this.phase];
    if (this.tickInPhase >= phaseTicks) {
      const next = PHASE_ORDER[(PHASE_ORDER.indexOf(this.phase) + 1) % PHASE_ORDER.length]!;
      this.enterPhase(next);
      return;
    }

    if (this.phase === 'driving') {
      // Along the route at a steady speed.
      const stepM = this.route.lengthM / this.route.driveTicks;
      const at = alongRoute(this.route, this.drivenM());
      this.lat = at.lat;
      this.lon = at.lon;
      this.heading = at.heading;
      this.mileageM += stepM;
      this.battery = Math.max(5, this.battery - usedPct(stepM));
      this.emit({
        gnssLocation: {
          latitude: this.lat,
          longitude: this.lon,
          timeStamp: ts(),
          isAuthorized: true,
        },
        gnssSpeed: v(Number(this.speedMps().toFixed(1))),
        gnssBearing: v(Math.round(this.heading)),
        gnssAltitude: v(altitudeAt(this.tickInPhase)),
        batteryLevel: v(Number(this.battery.toFixed(1))),
        distanceToEmpty: v(Math.round(this.battery * 4.4)),
        vehicleMileage: v(Math.round(this.mileageM)),
        cabinClimateInteriorTemperature: v(21),
      });
      this.emitGnss();
      this.emitTripProgress();
    } else if (this.phase === 'charging') {
      this.battery = Math.min(85, this.battery + 0.12);
      this.sessionEnergyKwh += (11.5 * TICK_MS) / 3_600_000;
      this.emit({
        batteryLevel: v(Number(this.battery.toFixed(1))),
        distanceToEmpty: v(Math.round(this.battery * 4.4)),
        timeToEndOfCharge: v(((PHASE_TICKS.charging - this.tickInPhase) * (TICK_MS / 1000)) / 60),
      });
      void this.pushCharging();
      const thermalKwh = Math.min(0.4, this.sessionEnergyKwh * 0.04);
      this.emitParallax(RVM_CHARGE_BREAKDOWN, [
        ...float(1, this.sessionEnergyKwh),
        ...float(2, this.sessionEnergyKwh - thermalKwh),
        ...float(5, thermalKwh),
        ...int(6, Math.floor((this.tickInPhase * TICK_MS) / 60_000)),
        ...int(8, Math.round(this.sessionEnergyKwh * 3.4)),
      ]);
    }
    if (this.tickInPhase % 5 === 0) this.emitBatteryState();
  }

  /** Distance driven along the route so far this drive. */
  private drivenM(): number {
    return (this.route.lengthM * this.tickInPhase) / this.route.driveTicks;
  }

  private speedMps(): number {
    return this.route.lengthM / this.route.driveTicks / (TICK_MS / 1000);
  }

  private async pushCharging(): Promise<void> {
    this.chargingCallback?.(this.subscribedId, await this.getLiveSessionData(MOCK_VIN));
  }

  private enterPhase(phase: Phase): void {
    if (this.phase === 'charging' && phase !== 'charging') {
      this.chargingCallback?.(this.subscribedId, null);
    }
    this.phase = phase;
    this.tickInPhase = 0;
    switch (phase) {
      case 'driving':
        this.emitTripInfo();
        this.emit({
          gearStatus: v('drive'),
          powerState: v('go'),
          chargerStatus: v('chrgr_sts_not_connected'),
          chargerState: v('not_charging'),
          doorFrontLeftLocked: v('locked'),
        });
        break;
      case 'arriving':
      case 'parked':
        // A scene's drive is done once; the loop takes over after it.
        if (phase === 'parked') this.route = LOOP_ROUTE;
        this.emitParallax(RVM_TRIP_INFO, []); // navigation ended
        this.emit({
          gearStatus: v('park'),
          powerState: v('standby'),
          gnssSpeed: v(0),
          chargerStatus: v('chrgr_sts_not_connected'),
          chargerState: v('not_charging'),
        });
        break;
      case 'charging':
        this.sessionEnergyKwh = 0;
        this.sessionStart = ts();
        this.sessionStartSoc = this.battery;
        this.emit({
          gearStatus: v('park'),
          powerState: v('standby'),
          chargerStatus: v('chrgr_sts_connected_charging'),
          chargerState: v('charging_active'),
          chargePortState: v('closed'),
        });
        break;
    }
    this.emitGnss();
  }

  private emit(state: VehicleState): void {
    this.callback?.(this.subscribedId, state);
  }

  private fullState(): VehicleState {
    const driving = this.phase === 'driving';
    const charging = this.phase === 'charging';
    return {
      cloudConnection: { lastSync: ts(), isOnline: true },
      gnssLocation: {
        latitude: this.lat,
        longitude: this.lon,
        timeStamp: ts(),
        isAuthorized: true,
      },
      gnssSpeed: v(driving ? Number(this.speedMps().toFixed(1)) : 0),
      gnssBearing: v(Math.round(this.heading)),
      gnssAltitude: v(240),
      batteryLevel: v(Number(this.battery.toFixed(1))),
      batteryLimit: v(85),
      batteryCapacity: v(135),
      distanceToEmpty: v(Math.round(this.battery * 4.4)),
      vehicleMileage: v(Math.round(this.mileageM)),
      powerState: v(driving ? 'go' : 'standby'),
      gearStatus: v(driving ? 'drive' : 'park'),
      driveMode: v('everyday'),
      chargerStatus: v(charging ? 'chrgr_sts_connected_charging' : 'chrgr_sts_not_connected'),
      chargerState: v(charging ? 'charging_active' : 'not_charging'),
      chargePortState: v('closed'),
      timeToEndOfCharge: v(charging ? 30 : 0),
      cabinClimateInteriorTemperature: v(21),
      cabinClimateDriverTemperature: v(20.5),
      cabinPreconditioningStatus: v('off'),
      doorFrontLeftClosed: v('closed'),
      doorFrontLeftLocked: v('locked'),
      doorFrontRightClosed: v('closed'),
      doorFrontRightLocked: v('locked'),
      doorRearLeftClosed: v('closed'),
      doorRearLeftLocked: v('locked'),
      doorRearRightClosed: v('closed'),
      doorRearRightLocked: v('locked'),
      closureFrunkClosed: v('closed'),
      closureFrunkLocked: v('locked'),
      closureLiftgateClosed: v('closed'),
      closureLiftgateLocked: v('locked'),
      windowFrontLeftClosed: v('closed'),
      windowFrontRightClosed: v('closed'),
      windowRearLeftClosed: v('closed'),
      windowRearRightClosed: v('closed'),
      alarmSoundStatus: v('false'),
      gearGuardLocked: v('locked'),
      tirePressureStatusFrontLeft: v('OK'),
      tirePressureStatusFrontRight: v('OK'),
      tirePressureStatusRearLeft: v('OK'),
      tirePressureStatusRearRight: v('OK'),
      tirePressureFrontLeft: v(3.2),
      tirePressureFrontRight: v(3.2),
      tirePressureRearLeft: v(3.1),
      tirePressureRearRight: v(3.2),
      twelveVoltBatteryHealth: v('OK'),
      wiperFluidState: v('normal'),
      brakeFluidLow: v('false'),
      otaCurrentVersion: v('2026.34.1'),
      otaAvailableVersion: v('2026.36.2'),
      otaStatus: v('Ready_To_Install'),
      otaCurrentStatus: v('Install_Success'),
      otaInstallReady: v('ota_available'),
      otaDownloadProgress: v(0),
      otaInstallProgress: v(0),
      otaInstallDuration: v(65),
      otaInstallType: v('Convenience'),
      serviceMode: v('off'),
      carWashMode: v('off'),
      petModeStatus: v('off'),
      seatFrontLeftHeat: v('off'),
      seatFrontRightHeat: v('off'),
      steeringWheelHeat: v('off'),
      defrostDefogStatus: v('off'),
      rearHitchStatus: v('unhitched'),
      trailerStatus: v('not_connected'),
    };
  }
}
