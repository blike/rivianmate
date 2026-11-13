import { randomUUID } from 'node:crypto';
import {
  APOLLO_CLIENT_NAME,
  BASE_HEADERS,
  CREATE_CSRF_TOKEN,
  GET_CHARGING_SCHEDULE,
  GET_COMPLETED_SESSION_SUMMARIES,
  GET_DELIVERY,
  GET_ORDER,
  GET_ORDER_IMAGES,
  GET_ORDER_SNAPSHOTS,
  GET_OTA_UPDATE_DETAILS,
  GET_REGISTERED_WALLBOXES,
  GET_USER_INFO,
  GET_VEHICLE_DETAILS,
  GET_VEHICLE_IMAGES,
  GRAPHQL_CHARGING,
  GRAPHQL_GATEWAY,
  GRAPHQL_ORDERS,
  LOGIN,
  LOGIN_WITH_OTP,
  VEHICLE_STATE_PROPERTIES,
  buildVehicleStateQuery,
} from './graphql.js';
import { RivianGovernor, parseRetryAfter } from './governor.js';
import {
  ChargeSessionSummary,
  ChargingSchedule,
  Delivery,
  LoginResult,
  OrderDetail,
  OrderSnapshot,
  OrderVehicle,
  OtaReleaseNotes,
  OtaUpdateDetails,
  RivianApiError,
  RivianAppSession,
  RivianCooldownError,
  RivianRateLimitError,
  RivianSessionManagerError,
  RivianTokens,
  RivianUnauthenticatedError,
  UserInfo,
  VEHICLE_VIEWS,
  VehicleDetails,
  VehicleImageUrls,
  VehicleState,
  type VehicleView,
  Wallbox,
  mapGraphqlError,
} from './types.js';

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
  /** Build and configuration details, keyed by vehicle id. */
  getVehicleDetails(): Promise<Record<string, VehicleDetails>>;
  /** Renders of each vehicle in its own paint and wheels, keyed by vehicle id. */
  getVehicleImageUrls(): Promise<Record<string, VehicleImageUrls>>;
  /** The account's orders, delivered or not. */
  getOrderSnapshots(): Promise<OrderSnapshot[]>;
  /** One order in detail; null when Rivian has no such order. */
  getOrder(orderId: string): Promise<OrderDetail | null>;
  /** An order's delivery appointment; null when Rivian answers with none. */
  getDelivery(orderId: string): Promise<Delivery | null>;
  /** Renders of each ordered vehicle in its configuration, keyed by order id. */
  getOrderImageUrls(): Promise<Record<string, VehicleImageUrls>>;
  /** `vehicleId` is the id from getUserInfo's vehicles[].id, not the VIN. */
  getVehicleState(vehicleId: string, properties?: readonly string[]): Promise<VehicleState>;
  getRegisteredWallboxes(): Promise<Wallbox[]>;
  /** Release notes for the vehicle's installed and pending software. */
  getOtaUpdateDetails(vehicleId: string): Promise<OtaUpdateDetails>;
  getChargingSchedules(vehicleId: string): Promise<ChargingSchedule[]>;
  /** Completed charging sessions for the whole account. */
  getChargeHistory(): Promise<ChargeSessionSummary[]>;
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
      operationName: 'CreateCSRFToken',
      query: CREATE_CSRF_TOKEN,
      variables: null,
    });
    this.csrfToken = data.createCsrfToken.csrfToken;
    this.appSessionToken = data.createCsrfToken.appSessionToken;
  }

  refreshSession(): Promise<void> {
    this.sessionRefresh ??= (async () => {
      try {
        this.governor.count('sessionRefreshes');
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
    }>(
      GRAPHQL_GATEWAY,
      {
        operationName: 'Login',
        query: LOGIN,
        variables: { email, password },
      },
      this.csrfHeaders(),
    );

    if (data.login.otpToken) {
      this.otpTokenPending = data.login.otpToken;
      return { kind: 'otp', otpToken: data.login.otpToken };
    }
    this._tokens = {
      accessToken: data.login.accessToken!,
      refreshToken: data.login.refreshToken!,
      userSessionToken: data.login.userSessionToken!,
    };
    return { kind: 'tokens', tokens: this._tokens };
  }

  async loginWithOtp(email: string, otpCode: string, otpToken?: string): Promise<RivianTokens> {
    const token = otpToken ?? this.otpTokenPending;
    if (!token) throw new RivianApiError('No pending OTP token');
    const data = await this.request<{
      loginWithOTP: {
        accessToken: string;
        refreshToken: string;
        userSessionToken: string;
      };
    }>(
      GRAPHQL_GATEWAY,
      {
        operationName: 'LoginWithOTP',
        query: LOGIN_WITH_OTP,
        variables: { email, otpCode, otpToken: token },
      },
      this.csrfHeaders(),
    );
    this.otpTokenPending = undefined;
    this._tokens = {
      accessToken: data.loginWithOTP.accessToken,
      refreshToken: data.loginWithOTP.refreshToken,
      userSessionToken: data.loginWithOTP.userSessionToken,
    };
    return this._tokens;
  }

  async getUserInfo(): Promise<UserInfo> {
    const data = await this.authenticatedRequest<{ currentUser: UserInfo }>(GRAPHQL_GATEWAY, {
      operationName: 'getUserInfo',
      query: GET_USER_INFO,
      variables: null,
    });
    return data.currentUser;
  }

  async getVehicleDetails(): Promise<Record<string, VehicleDetails>> {
    type Option = { optionName: string | null } | null;
    const data = await this.authenticatedRequest<{
      currentUser: {
        vehicles: {
          id: string;
          vehicle: {
            actualGeneralAssemblyDate: string | null;
            mobileConfiguration: Record<string, Option> | null;
          } | null;
        }[];
      };
    }>(GRAPHQL_GATEWAY, {
      operationName: 'getVehicleDetails',
      query: GET_VEHICLE_DETAILS,
      variables: null,
    });
    return Object.fromEntries(
      data.currentUser.vehicles.map(({ id, vehicle }) => {
        const option = (key: string) => vehicle?.mobileConfiguration?.[key]?.optionName ?? null;
        return [
          id,
          {
            builtOn: vehicle?.actualGeneralAssemblyDate ?? null,
            trim: option('trimOption'),
            driveSystem: option('driveSystemOption'),
            exteriorColor: option('exteriorColorOption'),
            interiorColor: option('interiorColorOption'),
            wheels: option('wheelOption'),
            tonneau: option('tonneauOption'),
          },
        ];
      }),
    );
  }

  async getVehicleImageUrls(): Promise<Record<string, VehicleImageUrls>> {
    const data = await this.authenticatedRequest<{
      getVehicleMobileImages: (RenderImage & { vehicleId: string })[];
    }>(GRAPHQL_GATEWAY, {
      operationName: 'getVehicleImages',
      query: GET_VEHICLE_IMAGES,
      variables: { version: '3' },
    });
    return bestRenders(data.getVehicleMobileImages, (i) => i.vehicleId);
  }

  async getOrderImageUrls(): Promise<Record<string, VehicleImageUrls>> {
    const data = await this.authenticatedRequest<{
      getVehicleOrderMobileImages: (RenderImage & { orderId: string | null })[] | null;
    }>(GRAPHQL_GATEWAY, {
      operationName: 'getVehicleOrderImages',
      query: GET_ORDER_IMAGES,
      variables: { version: '3' },
    });
    return bestRenders(data.getVehicleOrderMobileImages ?? [], (i) => i.orderId);
  }

  async getOrderSnapshots(): Promise<OrderSnapshot[]> {
    const data = await this.ordersRequest<{
      user: { orderSnapshots: Partial<OrderSnapshot>[] | null } | null;
    }>({ operationName: 'getOrderSnapshots', query: GET_ORDER_SNAPSHOTS, variables: null });
    return (data.user?.orderSnapshots ?? []).map((o) => ({
      id: String(o.id),
      state: o.state ?? '',
      configurationStatus: o.configurationStatus ?? null,
      fulfillmentSummaryStatus: o.fulfillmentSummaryStatus ?? null,
      vehicleId: o.vehicleId ?? null,
      vin: o.vin ?? null,
    }));
  }

  async getOrder(orderId: string): Promise<OrderDetail | null> {
    type Window = { startDate: string | null; endDate: string | null };
    type Raw = Partial<
      Omit<OrderDetail, 'vehicle' | 'items' | 'payments' | 'estimatedDelivery'>
    > & {
      vehicle: (Partial<Omit<OrderVehicle, 'modelYear'>> & { modelYear?: string | number }) | null;
      items:
        | {
            title: string | null;
            type: string | null;
            configuration: {
              options:
                | { optionId: string | null; optionName: string | null; groupId: string | null }[]
                | null;
            } | null;
          }[]
        | null;
      payments:
        | {
            id: string | null;
            amount: number | string | null;
            status: string | null;
            method: string | null;
            type: string | null;
            intent: string | null;
            date: string | null;
          }[]
        | null;
      fulfillmentInfo: {
        fulfillments: { estimatedDeliveryWindow: Window | null }[] | null;
      } | null;
    };
    const data = await this.ordersRequest<{ order: Raw | null }>({
      operationName: 'order',
      query: GET_ORDER,
      variables: { id: orderId },
    });
    const o = data.order;
    if (!o) return null;
    const v = o.vehicle;
    const windows = (o.fulfillmentInfo?.fulfillments ?? [])
      .map((f) => f.estimatedDeliveryWindow)
      .filter((w): w is Window => Boolean(w?.startDate || w?.endDate))
      .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
    const window = windows[0];
    return {
      id: String(o.id ?? orderId),
      type: o.type ?? null,
      state: o.state ?? null,
      orderDate: o.orderDate ?? null,
      configurationStatus: o.configurationStatus ?? null,
      fulfillmentSummaryStatus: o.fulfillmentSummaryStatus ?? null,
      vehicle: v
        ? {
            vehicleId: v.vehicleId ?? null,
            vin: v.vin ?? null,
            modelYear: v.modelYear != null ? String(v.modelYear) : null,
            model: v.model ?? null,
            make: v.make ?? null,
            plannedBuildDate: v.plannedBuildDate ?? null,
            expectedBuildDate: v.expectedBuildDate ?? null,
            expectedGeneralAssemblyStartDate: v.expectedGeneralAssemblyStartDate ?? null,
            actualGeneralAssemblyDate: v.actualGeneralAssemblyDate ?? null,
            status: v.status ?? null,
          }
        : null,
      items: (o.items ?? []).map((item) => ({
        type: item.type ?? null,
        title: item.title ?? null,
        options: (item.configuration?.options ?? []).map((opt) => ({
          group: opt.groupId ?? null,
          id: opt.optionId ?? null,
          name: opt.optionName ?? null,
        })),
      })),
      payments: (o.payments ?? [])
        .map((p) => {
          const amount = p.amount != null ? Number(p.amount) : null;
          return {
            id: p.id ?? null,
            amount: amount != null && Number.isFinite(amount) ? amount : null,
            status: p.status ?? null,
            method: p.method ?? null,
            type: p.type ?? null,
            intent: p.intent ?? null,
            date: p.date ?? null,
          };
        })
        .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
      estimatedDelivery: window
        ? { start: window.startDate ?? null, end: window.endDate ?? null }
        : null,
    };
  }

  async getDelivery(orderId: string): Promise<Delivery | null> {
    type Raw = {
      status: string | null;
      carrier: string | null;
      vehicleVIN: string | null;
      appointmentDetails: {
        appointmentId: string | null;
        startDateTime: string | null;
        endDateTime: string | null;
        timeZone: string | null;
      } | null;
      deliveryAddress: {
        addressLine1: string | null;
        addressLine2: string | null;
        city: string | null;
        state: string | null;
        zipcode: string | null;
      } | null;
    };
    if (!this.appSessionToken) await this.refreshSession();
    // Not authenticatedRequest: it answers on the session headers, but a
    // refusal may be the resolver's own (rivian-order-view sees one tied to
    // the access token), which rotating the shared session can't fix.
    const data = await this.request<{ delivery: Raw | null }>(
      GRAPHQL_GATEWAY,
      { operationName: 'delivery', query: GET_DELIVERY, variables: { orderId } },
      this.sessionHeaders(),
    );
    const d = data.delivery;
    if (!d) return null;
    const appt = d.appointmentDetails;
    const addr = d.deliveryAddress;
    return {
      status: d.status ?? null,
      carrier: d.carrier ?? null,
      vin: d.vehicleVIN ?? null,
      appointment: appt
        ? {
            id: appt.appointmentId ?? null,
            start: appt.startDateTime ?? null,
            end: appt.endDateTime ?? null,
            timeZone: appt.timeZone ?? null,
          }
        : null,
      address: addr
        ? {
            line1: addr.addressLine1 ?? null,
            line2: addr.addressLine2 ?? null,
            city: addr.city ?? null,
            state: addr.state ?? null,
            zipcode: addr.zipcode ?? null,
          }
        : null,
    };
  }

  /**
   * A call to the orders service. Only a stale CSRF token rotates the
   * session (the service says so with CSRF_TOKEN_EXPIRED, over HTTP 200 and
   * data: null). Any other auth error may just mean this service won't take
   * the app's session, and rotating would churn the session every other
   * caller shares.
   */
  private async ordersRequest<T>(body: GraphqlRequest): Promise<T> {
    if (!this.appSessionToken) await this.refreshSession();
    try {
      return await this.request<T>(GRAPHQL_ORDERS, body, this.sessionHeaders());
    } catch (err) {
      if (!(err instanceof RivianApiError) || err.code !== 'CSRF_TOKEN_EXPIRED') throw err;
      await this.refreshSession();
      return await this.request<T>(GRAPHQL_ORDERS, body, this.sessionHeaders());
    }
  }

  async getVehicleState(
    vehicleId: string,
    properties: readonly string[] = VEHICLE_STATE_PROPERTIES,
  ): Promise<VehicleState> {
    const data = await this.authenticatedRequest<{ vehicleState: VehicleState }>(GRAPHQL_GATEWAY, {
      operationName: 'GetVehicleState',
      query: buildVehicleStateQuery(properties),
      variables: { vehicleID: vehicleId },
    });
    return data.vehicleState;
  }

  async getRegisteredWallboxes(): Promise<Wallbox[]> {
    const data = await this.authenticatedRequest<{
      getRegisteredWallboxes: Wallbox[];
    }>(GRAPHQL_CHARGING, {
      operationName: 'getRegisteredWallboxes',
      query: GET_REGISTERED_WALLBOXES,
      variables: null,
    });
    return data.getRegisteredWallboxes ?? [];
  }

  async getOtaUpdateDetails(vehicleId: string): Promise<OtaUpdateDetails> {
    const data = await this.authenticatedRequest<{
      getVehicle: {
        currentOTAUpdateDetails: OtaReleaseNotes | null;
        availableOTAUpdateDetails: OtaReleaseNotes | null;
      } | null;
    }>(GRAPHQL_GATEWAY, {
      operationName: 'getOTAUpdateDetails',
      query: GET_OTA_UPDATE_DETAILS,
      variables: { vehicleId },
    });
    return {
      current: data.getVehicle?.currentOTAUpdateDetails ?? null,
      available: data.getVehicle?.availableOTAUpdateDetails ?? null,
    };
  }

  async getChargingSchedules(vehicleId: string): Promise<ChargingSchedule[]> {
    const data = await this.authenticatedRequest<{
      getVehicle: { chargingSchedules: ChargingSchedule[] | null } | null;
    }>(GRAPHQL_GATEWAY, {
      operationName: 'GetChargingSchedule',
      query: GET_CHARGING_SCHEDULE,
      variables: { vehicleId },
    });
    return data.getVehicle?.chargingSchedules ?? [];
  }

  async getChargeHistory(): Promise<ChargeSessionSummary[]> {
    const data = await this.authenticatedRequest<{
      getCompletedSessionSummaries: ChargeSessionSummary[] | null;
    }>(GRAPHQL_CHARGING, {
      operationName: 'getCompletedSessionSummaries',
      query: GET_COMPLETED_SESSION_SUMMARIES,
      variables: null,
    });
    return data.getCompletedSessionSummaries ?? [];
  }

  private csrfHeaders(): Record<string, string> {
    return {
      'Csrf-Token': this.csrfToken ?? '',
      'A-Sess': this.appSessionToken ?? '',
    };
  }

  /** Authenticate with the user session, as in the original connection flow. */
  private sessionHeaders(): Record<string, string> {
    // Do not attach the separately stored access token as a Bearer token:
    // rotating the app session does not renew that token.
    return {
      ...this.csrfHeaders(),
      'U-Sess': this._tokens?.userSessionToken ?? '',
    };
  }

  /**
   * Authenticated call. An expired CSRF/app session surfaces as either
   * SESSION_MANAGER_ERROR or UNAUTHENTICATED; rotate the session once and
   * retry. Only a failure after that rotation is reported to the caller.
   */
  private async authenticatedRequest<T>(url: string, body: GraphqlRequest): Promise<T> {
    if (!this.appSessionToken) await this.refreshSession();
    try {
      return await this.request<T>(url, body, this.sessionHeaders());
    } catch (err) {
      if (err instanceof RivianSessionManagerError || err instanceof RivianUnauthenticatedError) {
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
        this.governor.count('httpErrors');
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
        method: 'POST',
        headers: {
          ...BASE_HEADERS,
          'dc-cid': `m-ios-${randomUUID()}`,
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
        'RATE_LIMIT',
        undefined,
        429,
      );
      err.retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
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
        err.retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
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

interface RenderImage {
  url: string;
  resolution: string;
  size: string;
  design: string;
  placement: string;
}

/**
 * The best render of each view, grouped by `keyOf`. Large @2x renders are
 * 750px across, enough for a card at any density; dark designs are drawn
 * for dark backgrounds, which the app always has.
 */
function bestRenders<I extends RenderImage>(
  images: readonly I[],
  keyOf: (image: I) => string | null,
): Record<string, VehicleImageUrls> {
  const rank = (i: RenderImage) =>
    (i.design === 'dark' ? 2 : 0) + (i.size === 'large' && i.resolution === '@2x' ? 1 : 0);
  const best: Record<string, Partial<Record<VehicleView, RenderImage>>> = {};
  for (const image of images) {
    const key = keyOf(image);
    const view = VEHICLE_VIEWS.find((v) => v === image.placement);
    if (!key || !view) continue;
    const views = (best[key] ??= {});
    const current = views[view];
    if (!current || rank(image) > rank(current)) views[view] = image;
  }
  return Object.fromEntries(
    Object.entries(best).map(([key, views]) => [
      key,
      Object.fromEntries(Object.entries(views).map(([view, i]) => [view, i.url])),
    ]),
  );
}

export { APOLLO_CLIENT_NAME };
