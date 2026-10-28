/**
 * Parallax: Rivian's newer vehicle feed, on the same WebSocket as legacy;
 * each message is a base64 protobuf for one topic ("RVM").
 *
 * - wire.ts: protobuf reading
 * - define.ts: what a topic definition holds
 * - domains/: each topic's decoder and definition, by Rivian domain
 * - registry.ts: every definition, and what's derived from them
 *
 * To add a topic, define it in its domain file and list it there, without
 * a decoder (a probe, archived only) until it's checked against a real
 * vehicle; giving it one makes it read.
 *
 * Conventions:
 * - Topics that are only legacy fields decode inline (`readings`,
 *   `toState: stampReadings`); structured ones get a typed `decodeX`.
 * - Field numbers are documented where they're read.
 * - `decodePayload` treats an empty payload as no reading; `fieldsOrEmpty`
 *   as an all-zero message (proto3 leaves zeros out).
 */
export * from './wire.js';
export * from './define.js';
export * from './describe.js';
export * from './registry.js';
export * from './domains/body.js';
export * from './domains/charging.js';
export * from './domains/comfort.js';
export * from './domains/departure.js';
export * from './domains/dynamics.js';
export * from './domains/energy.js';
export * from './domains/navigation.js';
export * from './domains/ota.js';
export * from './domains/security.js';
export * from './domains/vehicle.js';
