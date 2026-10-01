import { EventEmitter } from "node:events";
import type { LiveSessionData, VehicleState } from "../rivian/types.js";

export interface LiveEvents {
  state: (vehicleId: string, state: VehicleState) => void;
  chargingSession: (vehicleId: string, session: LiveSessionData | null) => void;
}

/** In-process fanout from the monitor services to SSE connections. */
export class LiveBus {
  private emitter = new EventEmitter();
  /** Latest charging session per vehicle, replayed to new SSE clients. */
  private chargingSessions = new Map<string, LiveSessionData | null>();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emitState(vehicleId: string, state: VehicleState): void {
    this.emitter.emit("state", vehicleId, state);
  }

  emitChargingSession(vehicleId: string, session: LiveSessionData | null): void {
    this.chargingSessions.set(vehicleId, session);
    this.emitter.emit("chargingSession", vehicleId, session);
  }

  latestChargingSession(vehicleId: string): LiveSessionData | null {
    return this.chargingSessions.get(vehicleId) ?? null;
  }

  onState(listener: LiveEvents["state"]): () => void {
    this.emitter.on("state", listener);
    return () => this.emitter.off("state", listener);
  }

  onChargingSession(listener: LiveEvents["chargingSession"]): () => void {
    this.emitter.on("chargingSession", listener);
    return () => this.emitter.off("chargingSession", listener);
  }
}
