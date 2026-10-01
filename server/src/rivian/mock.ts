import type { RivianApi } from "./client.js";
import type {
  ChargingSessionCallback,
  VehicleStateCallback,
  VehicleStateStream,
} from "./subscription.js";
import {
  LiveSessionData,
  LoginResult,
  RivianInvalidOtpError,
  RivianTokens,
  TimeStampedValue,
  UserInfo,
  VehicleState,
  Wallbox,
} from "./types.js";

export const MOCK_VIN = "7FCTGAAA0MN000001";
export const MOCK_VEHICLE_ID = "mock-vehicle-1";
export const MOCK_OTP = "000000";

const TICK_MS = 2_000;

type Phase = "parked" | "driving" | "arriving" | "charging";

/** Ticks per phase: park 10 → drive 60 → park 10 → charge 60 → repeat. */
const PHASE_TICKS: Record<Phase, number> = {
  parked: 10,
  driving: 60,
  arriving: 10,
  charging: 60,
};

const PHASE_ORDER: Phase[] = ["parked", "driving", "arriving", "charging"];

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
  private subscribedId = MOCK_VEHICLE_ID;
  private timer?: NodeJS.Timeout;
  private phase: Phase = "parked";
  private tickInPhase = 0;

  // Rivian plant, Normal IL
  private lat = 40.5142;
  private lon = -88.9906;
  private heading = 90;
  private battery = 78;
  private mileageM = 12_345_678;
  private sessionEnergyKwh = 0;
  private sessionStart?: string;
  private sessionStartSoc = 0;

  get userSessionToken(): string | undefined {
    return this.tokens?.userSessionToken;
  }

  async createCsrfToken(): Promise<void> {}

  async refreshSession(): Promise<void> {}

  async login(_email: string, _password: string): Promise<LoginResult> {
    return { kind: "otp", otpToken: "mock-otp-token" };
  }

  async loginWithOtp(
    _email: string,
    otpCode: string,
    _otpToken?: string,
  ): Promise<RivianTokens> {
    if (otpCode !== MOCK_OTP) {
      throw new RivianInvalidOtpError("Invalid OTP (mock expects 000000)");
    }
    this.tokens = {
      accessToken: "mock-access",
      refreshToken: "mock-refresh",
      userSessionToken: "mock-usess",
    };
    return this.tokens;
  }

  async getUserInfo(): Promise<UserInfo> {
    return {
      id: "mock-user-1",
      vehicles: [
        {
          id: MOCK_VEHICLE_ID,
          vin: MOCK_VIN,
          name: "Mock R1T",
          roles: ["owner"],
          state: "ACTIVE",
          vehicle: {
            id: MOCK_VEHICLE_ID,
            vin: MOCK_VIN,
            modelYear: 2023,
            make: "RIVIAN",
            model: "R1T",
            vehicleState: {
              supportedFeatures: [
                { name: "SIDE_BIN_NXT_ACT", status: "AVAILABLE" },
                { name: "TAILGATE_CMD", status: "AVAILABLE" },
              ],
            },
          },
        },
      ],
    };
  }

  async getVehicleState(_vin: string): Promise<VehicleState> {
    return this.fullState();
  }

  async getLiveSessionData(_vin: string): Promise<LiveSessionData | null> {
    if (this.phase !== "charging") return null;
    const now = ts();
    return {
      chargerId: "mock-wallbox-1",
      currentCurrency: "USD",
      currentPrice: Number((this.sessionEnergyKwh * 0.14).toFixed(2)),
      isFreeSession: false,
      isRivianCharger: false,
      locationId: "home",
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
      vehicleChargerState: { value: "charging_active", updatedAt: now },
    };
  }

  async getRegisteredWallboxes(): Promise<Wallbox[]> {
    const charging = this.phase === "charging";
    return [
      {
        wallboxId: "mock-wallbox-1",
        userId: "mock-user-1",
        wifiId: "home-wifi",
        name: "Garage Wall Charger",
        linked: true,
        latitude: 40.5142,
        longitude: -88.9906,
        chargingStatus: charging ? "charging" : "standby",
        power: charging ? 11.5 : 0,
        currentVoltage: charging ? 240 : 0,
        currentAmps: charging ? 48 : 0,
        softwareVersion: "1.2.3",
        model: "W48-01-US",
        serialNumber: "MOCKWB0001",
        maxAmps: 48,
        maxVoltage: 240,
        maxPower: 11.5,
      },
    ];
  }

  async getOtaReleaseNotesUrl(_vehicleId: string): Promise<string | null> {
    return "https://example.com/rivian-release-notes/2024.14.00";
  }

  // --- VehicleStateStream ---

  subscribe(vehicleId: string, callback: VehicleStateCallback): void {
    this.subscribedId = vehicleId;
    this.callback = callback;
  }

  subscribeCharging(_vin: string, callback: ChargingSessionCallback): void {
    this.chargingCallback = callback;
  }

  start(): void {
    if (this.timer) return;
    this.onConnectionChange?.(true);
    this.onAuthenticated?.();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.emit(this.fullState());
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.onConnectionChange?.(false);
  }

  private tick(): void {
    this.tickInPhase += 1;
    if (this.tickInPhase >= PHASE_TICKS[this.phase]) {
      const next =
        PHASE_ORDER[(PHASE_ORDER.indexOf(this.phase) + 1) % PHASE_ORDER.length]!;
      this.enterPhase(next);
      return;
    }

    if (this.phase === "driving") {
      // ~0.5 km per tick along a gently curving path
      this.heading = (this.heading + (Math.random() * 10 - 5) + 360) % 360;
      const stepKm = 0.5;
      const rad = (this.heading * Math.PI) / 180;
      this.lat += (stepKm / 111.32) * Math.cos(rad);
      this.lon +=
        (stepKm / (111.32 * Math.cos((this.lat * Math.PI) / 180))) *
        Math.sin(rad);
      this.mileageM += stepKm * 1000;
      this.battery = Math.max(5, this.battery - 0.15);
      this.emit({
        gnssLocation: {
          latitude: this.lat,
          longitude: this.lon,
          timeStamp: ts(),
          isAuthorized: true,
        },
        gnssSpeed: v(25),
        gnssBearing: v(Math.round(this.heading)),
        // Rolling hills so elevation features have something to show.
        gnssAltitude: v(Math.round(240 + 35 * Math.sin(this.tickInPhase / 8))),
        batteryLevel: v(Number(this.battery.toFixed(1))),
        distanceToEmpty: v(Math.round(this.battery * 4.4)),
        vehicleMileage: v(Math.round(this.mileageM)),
        cabinClimateInteriorTemperature: v(21),
      });
    } else if (this.phase === "charging") {
      this.battery = Math.min(85, this.battery + 0.12);
      this.sessionEnergyKwh += (11.5 * TICK_MS) / 3_600_000;
      this.emit({
        batteryLevel: v(Number(this.battery.toFixed(1))),
        distanceToEmpty: v(Math.round(this.battery * 4.4)),
        timeToEndOfCharge: v(
          (PHASE_TICKS.charging - this.tickInPhase) * (TICK_MS / 1000) / 60,
        ),
      });
      void this.pushCharging();
    }
  }

  private async pushCharging(): Promise<void> {
    this.chargingCallback?.(this.subscribedId, await this.getLiveSessionData(MOCK_VIN));
  }

  private enterPhase(phase: Phase): void {
    if (this.phase === "charging" && phase !== "charging") {
      this.chargingCallback?.(this.subscribedId, null);
    }
    this.phase = phase;
    this.tickInPhase = 0;
    switch (phase) {
      case "driving":
        this.emit({
          gearStatus: v("drive"),
          powerState: v("go"),
          chargerStatus: v("chrgr_sts_not_connected"),
          chargerState: v("not_charging"),
          doorFrontLeftLocked: v("locked"),
        });
        break;
      case "arriving":
      case "parked":
        this.emit({
          gearStatus: v("park"),
          powerState: v("standby"),
          gnssSpeed: v(0),
          chargerStatus: v("chrgr_sts_not_connected"),
          chargerState: v("not_charging"),
        });
        break;
      case "charging":
        this.sessionEnergyKwh = 0;
        this.sessionStart = ts();
        this.sessionStartSoc = this.battery;
        this.emit({
          gearStatus: v("park"),
          powerState: v("standby"),
          chargerStatus: v("chrgr_sts_connected_charging"),
          chargerState: v("charging_active"),
          chargePortState: v("closed"),
        });
        break;
    }
  }

  private emit(state: VehicleState): void {
    this.callback?.(this.subscribedId, state);
  }

  private fullState(): VehicleState {
    const driving = this.phase === "driving";
    const charging = this.phase === "charging";
    return {
      cloudConnection: { lastSync: ts(), isOnline: true },
      gnssLocation: {
        latitude: this.lat,
        longitude: this.lon,
        timeStamp: ts(),
        isAuthorized: true,
      },
      gnssSpeed: v(driving ? 25 : 0),
      gnssBearing: v(Math.round(this.heading)),
      gnssAltitude: v(240),
      batteryLevel: v(Number(this.battery.toFixed(1))),
      batteryLimit: v(85),
      batteryCapacity: v(135),
      distanceToEmpty: v(Math.round(this.battery * 4.4)),
      vehicleMileage: v(Math.round(this.mileageM)),
      powerState: v(driving ? "go" : "standby"),
      gearStatus: v(driving ? "drive" : "park"),
      driveMode: v("everyday"),
      chargerStatus: v(
        charging ? "chrgr_sts_connected_charging" : "chrgr_sts_not_connected",
      ),
      chargerState: v(charging ? "charging_active" : "not_charging"),
      chargePortState: v("closed"),
      timeToEndOfCharge: v(charging ? 30 : 0),
      cabinClimateInteriorTemperature: v(21),
      cabinClimateDriverTemperature: v(20.5),
      cabinPreconditioningStatus: v("undefined_stat"),
      doorFrontLeftClosed: v("closed"),
      doorFrontLeftLocked: v("locked"),
      doorFrontRightClosed: v("closed"),
      doorFrontRightLocked: v("locked"),
      doorRearLeftClosed: v("closed"),
      doorRearLeftLocked: v("locked"),
      doorRearRightClosed: v("closed"),
      doorRearRightLocked: v("locked"),
      closureFrunkClosed: v("closed"),
      closureFrunkLocked: v("locked"),
      closureTailgateClosed: v("closed"),
      closureTailgateLocked: v("locked"),
      closureTonneauClosed: v("closed"),
      closureTonneauLocked: v("locked"),
      closureSideBinLeftClosed: v("closed"),
      closureSideBinLeftLocked: v("locked"),
      closureSideBinRightClosed: v("closed"),
      closureSideBinRightLocked: v("locked"),
      windowFrontLeftClosed: v("closed"),
      windowFrontRightClosed: v("closed"),
      windowRearLeftClosed: v("closed"),
      windowRearRightClosed: v("closed"),
      alarmSoundStatus: v("false"),
      gearGuardLocked: v("locked"),
      tirePressureStatusFrontLeft: v("OK"),
      tirePressureStatusFrontRight: v("OK"),
      tirePressureStatusRearLeft: v("OK"),
      tirePressureStatusRearRight: v("OK"),
      tirePressureFrontLeft: v(3.2),
      tirePressureFrontRight: v(3.2),
      tirePressureRearLeft: v(3.1),
      tirePressureRearRight: v(3.2),
      twelveVoltBatteryHealth: v("OK"),
      wiperFluidState: v("normal"),
      brakeFluidLow: v("false"),
      otaCurrentVersion: v("2024.14.00"),
      otaAvailableVersion: v("2024.14.00"),
      otaStatus: v("Idle"),
      otaInstallProgress: v(0),
      serviceMode: v("off"),
      carWashMode: v("off"),
      petModeStatus: v("off"),
      seatFrontLeftHeat: v("off"),
      seatFrontRightHeat: v("off"),
      steeringWheelHeat: v("off"),
      defrostDefogStatus: v("off"),
      rearHitchStatus: v("unhitched"),
      trailerStatus: v("not_connected"),
    };
  }
}
