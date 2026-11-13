import type { RivianApi } from '../rivian/client.js';
import {
  type Delivery,
  type OrderDetail,
  type OrderSnapshot,
  RivianApiError,
  VEHICLE_VIEWS,
  type VehicleImageUrls,
  type VehicleView,
} from '../rivian/types.js';
import { type Logger, silentLogger } from '../logger.js';

/** Orders on their way looked up in detail; each costs two requests. */
const MAX_PENDING_ORDERS = 3;
/** How often orders on their way are asked about again. Their statuses jump rather than tick. */
export const ORDER_REFRESH_MS = 15 * 60_000;

/**
 * What a lookup came back with. A failure is kept as one, never as an empty
 * answer: a refused delivery lookup isn't "no delivery scheduled".
 */
export type Lookup<T> = { ok: true; value: T } | { ok: false; error: string };

export interface OrderJourney {
  snapshot: OrderSnapshot;
  /** Whether getUserInfo lists the order's vehicle: delivered, and logged. */
  delivered: boolean;
  detail: Lookup<OrderDetail | null>;
  /** Null when not asked: the order isn't for a vehicle. */
  delivery: Lookup<Delivery | null> | null;
  renders: VehicleImageUrls;
}

/** What the tracker knows, for API & Feeds: every order and each lookup as answered. */
export interface OrderDiagnostics {
  checkedAt: string | null;
  /** When orders on their way are next asked about; null when none are. */
  nextCheckAt: string | null;
  /** The last order listing that failed, until one succeeds. */
  lastError: { at: string; message: string } | null;
  orders: OrderSnapshot[];
  /** As kept, but render URLs (which carry a token) reduced to their views. */
  journeys: (Omit<OrderJourney, 'renders'> & { renders: VehicleView[] })[];
}

async function lookup<T>(fn: () => Promise<T>): Promise<Lookup<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    const code = err instanceof RivianApiError ? err.code : undefined;
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: code ? `${code}: ${message}` : message };
  }
}

const STATUS_WORDS: Record<string, string> = {
  FACTORY_OK: 'passed factory checks',
  FACTORY_GATED: 'left the factory',
  STAGED_FOR_PDI: 'waiting for inspection',
  PDI_COMPLETED: 'inspected',
  VEHICLE_PREPPED: 'ready for delivery',
  DELIVERED: 'delivered',
};

/**
 * Follows the account's vehicle orders from the order to the delivery: the
 * order behind each delivered vehicle, and those still on their way (not in
 * getUserInfo yet), asked about again every ORDER_REFRESH_MS. Rivian's orders
 * service is undocumented, so a failure only logs; vehicles never depend on it.
 */
export class OrderTracker {
  private orders: OrderSnapshot[] = [];
  private journeys: OrderJourney[] = [];
  private checkedAt: Date | null = null;
  private lastError: { at: Date; message: string } | null = null;
  /** Each journey's last logged line, so an unchanged one isn't logged again. */
  private logged = new Map<string, string>();
  private timer?: NodeJS.Timeout;
  /** Bumped on every start/stop so a superseded lookup drops its answer. */
  private generation = 0;

  constructor(
    private readonly log: Logger = silentLogger,
    /** Called when a refresh finds a vehicle that wasn't in the account. */
    private readonly onNewVehicle: () => void = () => {},
  ) {}

  getJourneys(): OrderJourney[] {
    return this.journeys;
  }

  get checked(): Date | null {
    return this.checkedAt;
  }

  diagnostics(): OrderDiagnostics {
    return {
      checkedAt: this.checkedAt?.toISOString() ?? null,
      nextCheckAt:
        this.timer && this.checkedAt
          ? new Date(this.checkedAt.getTime() + ORDER_REFRESH_MS).toISOString()
          : null,
      lastError: this.lastError && {
        at: this.lastError.at.toISOString(),
        message: this.lastError.message,
      },
      orders: this.orders,
      journeys: this.journeys.map((j) => ({
        ...j,
        renders: VEHICLE_VIEWS.filter((v) => j.renders[v]),
      })),
    };
  }

  /**
   * Looks up every vehicle order for a new connection. `vehicleIds` are the
   * account's vehicles, for telling delivered orders from those on their way;
   * `knownVehicleIds` reads them again at each refresh.
   */
  async start(api: RivianApi, vehicleIds: string[], knownVehicleIds: () => string[]) {
    this.stop();
    const generation = ++this.generation;
    await this.check(api, vehicleIds, generation, false);
    if (generation === this.generation && this.journeys.some((j) => !j.delivered)) {
      this.timer = setInterval(
        () => void this.refresh(api, knownVehicleIds, generation),
        ORDER_REFRESH_MS,
      );
    }
  }

  stop(): void {
    this.generation += 1;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.orders = [];
    this.journeys = [];
    this.checkedAt = null;
    this.lastError = null;
  }

  /**
   * Asks about orders on their way again. First checks whether a new vehicle
   * has reached the account; if so, hands over so it's discovered and logged
   * like any other.
   */
  private async refresh(api: RivianApi, knownVehicleIds: () => string[], generation: number) {
    const info = await lookup(() => api.getUserInfo());
    if (generation !== this.generation) return;
    const known = new Set(knownVehicleIds());
    if (info.ok && info.value.vehicles.some((v) => !known.has(v.id))) {
      this.log.info('a new vehicle is in the account; reconnecting to start logging it');
      this.onNewVehicle();
      return;
    }
    await this.check(api, [...known], generation, true);
    if (generation === this.generation && !this.journeys.some((j) => !j.delivered)) {
      this.log.info('every order is delivered; no longer checking');
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Lists the orders and looks up each vehicle order's journey. `refresh`
   * asks only about orders on their way, keeping what's known of delivered
   * ones, which no longer change.
   */
  private async check(api: RivianApi, vehicleIds: string[], generation: number, refresh: boolean) {
    const superseded = () => generation !== this.generation;
    let orders: OrderSnapshot[];
    try {
      orders = await api.getOrderSnapshots();
    } catch (err) {
      if (superseded()) return;
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = { at: new Date(), message };
      this.log.warn({ err }, 'order listing failed');
      return;
    }
    if (superseded()) return;
    this.orders = orders;
    this.lastError = null;

    const listed = new Set(vehicleIds);
    const isDelivered = (o: OrderSnapshot) => o.vehicleId != null && listed.has(o.vehicleId);
    // A cancelled order never becomes a vehicle.
    const live = orders.filter((o) => o.state !== 'CANCELLED');
    // One order per delivered vehicle: a vehicle id can sit on a later order too.
    const delivered = [...new Map(live.filter(isDelivered).map((o) => [o.vehicleId, o])).values()];
    const pending = live.filter((o) => !isDelivered(o)).slice(0, MAX_PENDING_ORDERS);
    if (!refresh) {
      const cancelled = orders.length - live.length;
      const parts = [
        pending.length && `${pending.length} on its way`,
        delivered.length && `${delivered.length} delivered`,
        cancelled && `${cancelled} cancelled`,
      ].filter(Boolean);
      this.log.info(
        `found ${orders.length} order${orders.length === 1 ? '' : 's'}${parts.length ? `: ${parts.join(', ')}` : ''}`,
      );
    }

    const kept = refresh ? this.journeys.filter((j) => j.delivered) : [];
    const toLookUp = [
      ...(refresh ? [] : delivered.map((snapshot) => ({ snapshot, delivered: true }))),
      ...pending.map((snapshot) => ({ snapshot, delivered: false })),
    ];
    const looked = await this.lookUp(api, toLookUp, superseded);
    if (!looked) return;
    this.journeys = [
      ...looked.filter((j) => !j.delivered),
      ...kept,
      ...looked.filter((j) => j.delivered),
    ];
    this.checkedAt = new Date();
  }

  /** Null once superseded. */
  private async lookUp(
    api: RivianApi,
    orders: { snapshot: OrderSnapshot; delivered: boolean }[],
    superseded: () => boolean,
  ): Promise<OrderJourney[] | null> {
    const result: OrderJourney[] = [];
    for (const { snapshot, delivered } of orders) {
      const detail = await lookup(() => api.getOrder(snapshot.id));
      if (superseded()) return null;
      // Gear and accessory orders have no delivery appointment to ask for.
      const forVehicle =
        delivered ||
        !detail.ok ||
        detail.value?.vehicle != null ||
        detail.value?.type === 'VEHICLE' ||
        detail.value?.type === 'PRE_ORDER';
      if (!forVehicle) continue;
      const delivery = await lookup(() => api.getDelivery(snapshot.id));
      if (superseded()) return null;
      const known = this.journeys.find((j) => j.snapshot.id === snapshot.id);
      result.push({ snapshot, delivered, detail, delivery, renders: known?.renders ?? {} });
    }

    // Renders don't change: asked for once, while one is missing.
    if (result.some((j) => Object.keys(j.renders).length === 0)) {
      const renders = await lookup(() => api.getOrderImageUrls());
      if (superseded()) return null;
      if (renders.ok) {
        for (const j of result) j.renders = renders.value[j.snapshot.id] ?? j.renders;
      } else {
        this.log.warn(`order render lookup failed: ${renders.error}`);
      }
    }

    for (const j of result) this.logJourney(j);
    return result;
  }

  /** Logged only when changed; the whole journey is at debug and in API & Feeds. */
  private logJourney(j: OrderJourney): void {
    const orderId = j.snapshot.id;
    this.log.debug({ orderId, journey: j }, 'order looked up');
    const lines: { level: 'info' | 'warn'; text: string }[] = [];
    if (!j.detail.ok) lines.push({ level: 'warn', text: `order lookup failed: ${j.detail.error}` });
    if (j.delivery && !j.delivery.ok) {
      lines.push({ level: 'warn', text: `delivery lookup failed: ${j.delivery.error}` });
    }
    lines.push({ level: 'info', text: standing(j) });

    const key = lines.map((l) => l.text).join('\n');
    if (this.logged.get(orderId) === key) return;
    this.logged.set(orderId, key);
    for (const l of lines) this.log[l.level]({ orderId }, l.text);
  }
}

/** Dates as Rivian sent them, so a line can be checked against the raw answer. */
function standing(j: OrderJourney): string {
  const detail = j.detail.ok ? j.detail.value : null;
  const vehicle = detail?.vehicle;
  const model =
    vehicle?.model ??
    detail?.items.find((i) => i.type === 'VEHICLE')?.title?.match(/\bR\d[A-Z]?\b/)?.[0] ??
    'vehicle';
  const appt = j.delivery?.ok ? j.delivery.value?.appointment : null;
  const when = appt?.start
    ? `${appt.start.replace('T', ' ').slice(0, 16)}${appt.end ? `–${appt.end.slice(11, 16)}` : ''}${appt.timeZone ? ` ${appt.timeZone}` : ''}`
    : null;

  if (j.delivered)
    return `${model} delivered${when ? ` ${when.slice(0, 10)}` : ''}, in the account`;
  const status = vehicle?.status ? (STATUS_WORDS[vehicle.status] ?? vehicle.status) : null;
  const built = vehicle?.actualGeneralAssemblyDate;
  const state = [
    status,
    built
      ? `built ${built}`
      : vehicle?.plannedBuildDate
        ? `build planned ${vehicle.plannedBuildDate}`
        : null,
  ]
    .filter(Boolean)
    .join(', ');
  const delivery = j.delivery?.ok
    ? when
      ? `delivery ${when}`
      : 'no delivery appointment'
    : 'delivery unknown';
  const placed = detail?.reservedDate && !detail.orderedDate ? 'reserved' : 'on order';
  return `${model} ${state || (vehicle ? 'assigned to a build' : placed)}; ${delivery}`;
}
