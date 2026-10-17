import { type Logger, silentLogger } from '../logger.js';
import {
  type Decoded,
  type ParallaxMessage,
  type RvmDef,
  decodeMessage,
  messageTime,
  stateFromDecoded,
} from '../rivian/parallax/index.js';
import type { VehicleState } from '../rivian/types.js';

type MessageHandler = (
  vehicleId: string,
  decoded: Decoded | null,
  message: ParallaxMessage,
) => unknown;
type TopicHandler = (vehicleId: string, value: unknown, message: ParallaxMessage) => unknown;
type StateHandler = (vehicleId: string, delta: VehicleState) => unknown;

/**
 * Hands each Parallax message, decoded once by its topic's definition, to
 * whatever uses it: every message to `on` handlers, one topic's value to
 * `onTopic` handlers, and the legacy fields a topic stands in for to
 * `onState`. A handler that throws or rejects is logged and doesn't stop
 * the others.
 */
export class ParallaxRouter {
  private readonly messageHandlers: MessageHandler[] = [];
  private readonly topicHandlers = new Map<string, TopicHandler[]>();
  private readonly stateHandlers: StateHandler[] = [];

  constructor(private readonly log: Logger = silentLogger) {}

  /** Every message, with its decoded value when the topic has a definition. */
  on(handler: MessageHandler): this {
    this.messageHandlers.push(handler);
    return this;
  }

  /** One topic's decoded value; null when the message couldn't be read (or was empty). */
  onTopic<T>(
    def: RvmDef<T>,
    handler: (vehicleId: string, value: T | null, message: ParallaxMessage) => unknown,
  ): this {
    const handlers = this.topicHandlers.get(def.rvm) ?? [];
    handlers.push(handler as TopicHandler);
    this.topicHandlers.set(def.rvm, handlers);
    return this;
  }

  /** Legacy VehicleState fields from any topic that carries them, stamped with Rivian's time. */
  onState(handler: StateHandler): this {
    this.stateHandlers.push(handler);
    return this;
  }

  dispatch(vehicleId: string, message: ParallaxMessage): void {
    let decoded: Decoded | null = null;
    try {
      decoded = decodeMessage(message);
    } catch (err) {
      this.log.error({ err, rvm: message.rvm, vehicleId }, 'parallax decode failed');
    }
    for (const handler of this.messageHandlers) {
      this.run(message.rvm, () => handler(vehicleId, decoded, message));
    }
    if (!decoded) return;
    for (const handler of this.topicHandlers.get(message.rvm) ?? []) {
      this.run(message.rvm, () => handler(vehicleId, decoded.value, message));
    }
    if (this.stateHandlers.length === 0) return;
    const timeStamp = (messageTime(message.timestamp) ?? new Date()).toISOString();
    let delta: VehicleState | null = null;
    try {
      delta = stateFromDecoded(decoded, timeStamp);
    } catch (err) {
      this.log.error({ err, rvm: message.rvm, vehicleId }, 'parallax state failed');
    }
    if (!delta) return;
    for (const handler of this.stateHandlers) {
      this.run(message.rvm, () => handler(vehicleId, delta));
    }
  }

  private run(rvm: string, fn: () => unknown): void {
    const fail = (err: unknown) => this.log.error({ err, rvm }, 'parallax handler failed');
    try {
      const result = fn();
      if (result instanceof Promise) result.catch(fail);
    } catch (err) {
      fail(err);
    }
  }
}
