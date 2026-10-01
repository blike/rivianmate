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
import { RivianGovernor, parseRetryAfter } from "./governor.js";
import {
  LiveSessionData,
  LoginResult,
  RivianApiError,
  RivianAppSession,
  RivianCooldownError,
  RivianRateLimitError,
  RivianSessionManagerError,
  RivianTokens,
  RivianUnauthenticatedError,
  UserInfo,
  VehicleState,
  Wallbox,
  mapGraphqlError,
} from "./types.js";

export interface RivianClientOptions {
  tokens?: RivianTokens;
  timeoutMs?: number;
  /** Shared across every client and stream so limits apply per process. */
  governor?: RivianGovernor;
}

/** Minimal interface the rest of the app depends on (real + mock implement it). */
export interface RivianApi {
  readonly tokens: RivianTokens | undefined;
  readonly userSessionToken: string | undefined;
  /** Current CSRF/app session, also used for the WebSocket handshake. */
  readonly appSession: RivianAppSession | undefined;
  createCsrfToken(): Promise<void>;
  /**
   * Rotates the short-lived CSRF/app session. Concurrent callers share one
   * rotation, so an auth error seen by several consumers costs one request.
   */
  refreshSession(): Promise<void>;
  login(email: string, password: string): Promise<LoginResult>;
  loginWithOtp(email: string, otpCode: string, otpToken?: string): Promise<RivianTokens>;
  getUserInfo(): Promise<UserInfo>;
  /** `vehicleId` is the id from getUserInfo's vehicles[].id, not the VIN. */
  getVehicleState(
    vehicleId: string,
    properties?: readonly string[],
  ): Promise<VehicleState>;
  getLiveSessionData(vehicleId: string): Promise<LiveSessionData | null>;
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
  private sessionRefresh?: Promise<void>;
  private readonly timeoutMs: number;
  private readonly governor: RivianGovernor;

  constructor(options: RivianClientOptions = {}) {
    this._tokens = options.tokens;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.governor = options.governor ?? new RivianGovernor();
  }

  get appSession(): RivianAppSession | undefined {
    if (!this.csrfToken || !this.appSessionToken) return undefined;
    return { csrfToken: this.csrfToken, appSessionToken: this.appSessionToken };
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

  refreshSession(): Promise<void> {
    this.sessionRefresh ??= (async () => {
      try {
        this.governor.count("sessionRefreshes");
        await this.createCsrfToken();
      } finally {
        this.sessionRefresh = undefined;
      }
    })();
    return this.sessionRefresh;
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

  async getVehicleState(
    vehicleId: string,
    properties: readonly string[] = VEHICLE_STATE_PROPERTIES,
  ): Promise<VehicleState> {
    const data = await this.authenticatedRequest<{ vehicleState: VehicleState }>(
      GRAPHQL_GATEWAY,
      {
        operationName: "GetVehicleState",
        query: buildVehicleStateQuery(properties),
        variables: { vehicleID: vehicleId },
      },
    );
    return data.vehicleState;
  }

  async getLiveSessionData(vehicleId: string): Promise<LiveSessionData | null> {
    const data = await this.authenticatedRequest<{
      getLiveSessionData: LiveSessionData | null;
    }>(GRAPHQL_CHARGING, {
      operationName: "getLiveSessionData",
      query: buildLiveSessionQuery(),
      variables: { vehicleId: vehicleId },
    });
    return data.getLiveSessionData;
  }

  async getRegisteredWallboxes(): Promise<Wallbox[]> {
    const data = await this.authenticatedRequest<{
      getRegisteredWallboxes: Wallbox[];
    }>(GRAPHQL_CHARGING, {
      operationName: "getRegisteredWallboxes",
      query: GET_REGISTERED_WALLBOXES,
      variables: null,
    });
    return data.getRegisteredWallboxes ?? [];
  }

  private csrfHeaders(): Record<string, string> {
    return {
      "Csrf-Token": this.csrfToken ?? "",
      "A-Sess": this.appSessionToken ?? "",
    };
  }

  /** Headers the mobile app sends on authenticated calls. */
  private sessionHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.csrfHeaders(),
      "U-Sess": this._tokens?.userSessionToken ?? "",
    };
    if (this._tokens?.accessToken) {
      headers.Authorization = `Bearer ${this._tokens.accessToken}`;
    }
    return headers;
  }

  /**
   * Authenticated call. An expired CSRF/app session surfaces as either
   * SESSION_MANAGER_ERROR or UNAUTHENTICATED; rotate the session once and
   * retry. Only a failure after that rotation is reported to the caller.
   */
  private async authenticatedRequest<T>(
    url: string,
    body: GraphqlRequest,
  ): Promise<T> {
    if (!this.appSessionToken) await this.refreshSession();
    try {
      return await this.request<T>(url, body, this.sessionHeaders());
    } catch (err) {
      if (
        err instanceof RivianSessionManagerError ||
        err instanceof RivianUnauthenticatedError
      ) {
        await this.refreshSession();
        return await this.request<T>(url, body, this.sessionHeaders());
      }
      throw err;
    }
  }

  private async request<T>(
    url: string,
    body: GraphqlRequest,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    try {
      const data = await this.governor.schedule(body.operationName, () =>
        this.send<T>(url, body, extraHeaders),
      );
      this.governor.noteSuccess();
      return data;
    } catch (err) {
      if (err instanceof RivianCooldownError) {
        // Local fast-fail during a cooldown: nothing was sent.
      } else if (err instanceof RivianRateLimitError) {
        const cooldown = this.governor.noteRateLimited(err.retryAfterMs);
        err.retryAfterMs = cooldown;
      } else {
        this.governor.count("httpErrors");
      }
      throw err;
    }
  }

  private async send<T>(
    url: string,
    body: GraphqlRequest,
    extraHeaders: Record<string, string>,
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

    if (response.status === 429) {
      const err = new RivianRateLimitError(
        `Rivian rate limited ${body.operationName} (HTTP 429)`,
        "RATE_LIMIT",
        undefined,
        429,
      );
      err.retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      throw err;
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
      const err = mapGraphqlError(json.errors, response.status, json);
      if (err instanceof RivianRateLimitError) {
        err.retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      }
      throw err;
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
