import { randomUUID } from "node:crypto";
import {
  APOLLO_CLIENT_NAME,
  BASE_HEADERS,
  CREATE_CSRF_TOKEN,
  GET_REGISTERED_WALLBOXES,
  GET_USER_INFO,
  GRAPHQL_CHARGING,
  GRAPHQL_GATEWAY,
  LOGIN,
  LOGIN_WITH_OTP,
  VEHICLE_STATE_PROPERTIES,
  buildLiveSessionQuery,
  buildVehicleStateQuery,
} from "./graphql.js";
import {
  LiveSessionData,
  LoginResult,
  RivianApiError,
  RivianSessionManagerError,
  RivianTokens,
  UserInfo,
  VehicleState,
  Wallbox,
  mapGraphqlError,
} from "./types.js";

export interface RivianClientOptions {
  tokens?: RivianTokens;
  timeoutMs?: number;
}

/** Minimal interface the rest of the app depends on (real + mock implement it). */
export interface RivianApi {
  readonly tokens: RivianTokens | undefined;
  readonly userSessionToken: string | undefined;
  createCsrfToken(): Promise<void>;
  login(email: string, password: string): Promise<LoginResult>;
  loginWithOtp(email: string, otpCode: string, otpToken?: string): Promise<RivianTokens>;
  getUserInfo(): Promise<UserInfo>;
  getVehicleState(vin: string): Promise<VehicleState>;
  getLiveSessionData(vin: string): Promise<LiveSessionData | null>;
  getRegisteredWallboxes(): Promise<Wallbox[]>;
}

interface GraphqlRequest {
  operationName: string;
  query: string;
  variables: Record<string, unknown> | null;
}

export class RivianClient implements RivianApi {
  private csrfToken?: string;
  private appSessionToken?: string;
  private _tokens?: RivianTokens;
  private otpTokenPending?: string;
  private readonly timeoutMs: number;

  constructor(options: RivianClientOptions = {}) {
    this._tokens = options.tokens;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  get tokens(): RivianTokens | undefined {
    return this._tokens;
  }

  get userSessionToken(): string | undefined {
    return this._tokens?.userSessionToken;
  }

  async createCsrfToken(): Promise<void> {
    const data = await this.request<{
      createCsrfToken: { csrfToken: string; appSessionToken: string };
    }>(GRAPHQL_GATEWAY, {
      operationName: "CreateCSRFToken",
      query: CREATE_CSRF_TOKEN,
      variables: null,
    });
    this.csrfToken = data.createCsrfToken.csrfToken;
    this.appSessionToken = data.createCsrfToken.appSessionToken;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    if (!this.csrfToken) await this.createCsrfToken();
    const data = await this.request<{
      login: {
        __typename: string;
        accessToken?: string;
        refreshToken?: string;
        userSessionToken?: string;
        otpToken?: string;
      };
    }>(GRAPHQL_GATEWAY, {
      operationName: "Login",
      query: LOGIN,
      variables: { email, password },
    }, this.csrfHeaders());

    if (data.login.otpToken) {
      this.otpTokenPending = data.login.otpToken;
      return { kind: "otp", otpToken: data.login.otpToken };
    }
    this._tokens = {
      accessToken: data.login.accessToken!,
      refreshToken: data.login.refreshToken!,
      userSessionToken: data.login.userSessionToken!,
    };
    return { kind: "tokens", tokens: this._tokens };
  }

  async loginWithOtp(
    email: string,
    otpCode: string,
    otpToken?: string,
  ): Promise<RivianTokens> {
    const token = otpToken ?? this.otpTokenPending;
    if (!token) throw new RivianApiError("No pending OTP token");
    const data = await this.request<{
      loginWithOTP: {
        accessToken: string;
        refreshToken: string;
        userSessionToken: string;
      };
    }>(GRAPHQL_GATEWAY, {
      operationName: "LoginWithOTP",
      query: LOGIN_WITH_OTP,
      variables: { email, otpCode, otpToken: token },
    }, this.csrfHeaders());
    this.otpTokenPending = undefined;
    this._tokens = {
      accessToken: data.loginWithOTP.accessToken,
      refreshToken: data.loginWithOTP.refreshToken,
      userSessionToken: data.loginWithOTP.userSessionToken,
    };
    return this._tokens;
  }

  async getUserInfo(): Promise<UserInfo> {
    const data = await this.authenticatedRequest<{ currentUser: UserInfo }>(
      GRAPHQL_GATEWAY,
      { operationName: "getUserInfo", query: GET_USER_INFO, variables: null },
    );
    return data.currentUser;
  }

  async getVehicleState(vin: string): Promise<VehicleState> {
    const data = await this.authenticatedRequest<{ vehicleState: VehicleState }>(
      GRAPHQL_GATEWAY,
      {
        operationName: "GetVehicleState",
        query: buildVehicleStateQuery(VEHICLE_STATE_PROPERTIES),
        variables: { vehicleID: vin },
      },
    );
    return data.vehicleState;
  }

  async getLiveSessionData(vin: string): Promise<LiveSessionData | null> {
    const data = await this.authenticatedRequest<{
      getLiveSessionData: LiveSessionData | null;
    }>(GRAPHQL_CHARGING, {
      operationName: "getLiveSessionData",
      query: buildLiveSessionQuery(),
      variables: { vehicleId: vin },
    }, { "U-Sess": this._tokens?.userSessionToken ?? "" });
    return data.getLiveSessionData;
  }

  async getRegisteredWallboxes(): Promise<Wallbox[]> {
    const data = await this.authenticatedRequest<{
      getRegisteredWallboxes: Wallbox[];
    }>(GRAPHQL_CHARGING, {
      operationName: "getRegisteredWallboxes",
      query: GET_REGISTERED_WALLBOXES,
      variables: null,
    }, this.csrfSessionHeaders());
    return data.getRegisteredWallboxes ?? [];
  }

  private csrfHeaders(): Record<string, string> {
    return {
      "Csrf-Token": this.csrfToken ?? "",
      "A-Sess": this.appSessionToken ?? "",
    };
  }

  private sessionHeaders(): Record<string, string> {
    return {
      "A-Sess": this.appSessionToken ?? "",
      "U-Sess": this._tokens?.userSessionToken ?? "",
    };
  }

  private csrfSessionHeaders(): Record<string, string> {
    return { ...this.csrfHeaders(), "U-Sess": this._tokens?.userSessionToken ?? "" };
  }

  /**
   * Authenticated call with the HA-style recovery: on a session-manager /
   * expired-CSRF error, recreate the CSRF token once and retry.
   */
  private async authenticatedRequest<T>(
    url: string,
    body: GraphqlRequest,
    headers?: Record<string, string>,
  ): Promise<T> {
    if (!this.appSessionToken) await this.createCsrfToken();
    try {
      return await this.request<T>(url, body, headers ?? this.sessionHeaders());
    } catch (err) {
      if (err instanceof RivianSessionManagerError) {
        await this.createCsrfToken();
        return await this.request<T>(url, body, headers ?? this.sessionHeaders());
      }
      throw err;
    }
  }

  private async request<T>(
    url: string,
    body: GraphqlRequest,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          ...BASE_HEADERS,
          "dc-cid": `m-ios-${randomUUID()}`,
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new RivianApiError(
        `Network error calling ${body.operationName}: ${(err as Error).message}`,
      );
    }

    let json: {
      data?: T;
      errors?: { message?: string; extensions?: { code?: string; reason?: string } }[];
    };
    try {
      json = (await response.json()) as typeof json;
    } catch {
      throw new RivianApiError(
        `Non-JSON response (${response.status}) from ${body.operationName}`,
        undefined,
        undefined,
        response.status,
      );
    }

    if (json.errors?.length) {
      throw mapGraphqlError(json.errors, response.status, json);
    }
    if (!response.ok || json.data === undefined) {
      throw new RivianApiError(
        `Request ${body.operationName} failed with status ${response.status}`,
        undefined,
        undefined,
        response.status,
        json,
      );
    }
    return json.data;
  }
}

export { APOLLO_CLIENT_NAME };
