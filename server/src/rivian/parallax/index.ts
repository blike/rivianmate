/**
 * Parallax: Rivian's newer vehicle data feed. It shares the GraphQL
 * WebSocket with the legacy subscriptions, but each message carries a
 * base64 protobuf for one topic ("RVM").
 *
 * - wire.ts: protobuf reading, shared by every decoder
 * - define.ts: what a topic definition holds
 * - domains/: one file per Rivian domain, each topic's decoder and definition
 * - registry.ts: every definition, and what's derived from them
 *
 * To add a topic: write its definition in its domain file, add it to that
 * file's list, and give it `maturity: 'probe'` until it's checked against a
 * real vehicle, so it's subscribed apart from the working groups.
 */
export * from './wire.js';
export * from './define.js';
export * from './describe.js';
export * from './registry.js';
export * from './domains/body.js';
export * from './domains/charging.js';
export * from './domains/comfort.js';
export * from './domains/dynamics.js';
export * from './domains/energy.js';
export * from './domains/navigation.js';
export * from './domains/ota.js';
export * from './domains/vehicle.js';
