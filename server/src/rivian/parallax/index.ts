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
 *
 * Each domain file runs: a header naming the domain, its `RVM_*` names,
 * decoders and value maps, the definitions (keys in define.ts's order),
 * then the file's list. Within it:
 * - A topic that's only legacy field values decodes inline, with
 *   `readings` and `toState: stampReadings`. One whose value is a
 *   structure (read by the charging monitor, insights or navigation, or
 *   spread over several legacy fields, like GPS) gets a named, typed
 *   `decodeX`, which its tests call directly.
 * - Field numbers are documented on whatever reads them: the named
 *   decoder, or the definition when it decodes inline.
 * - An empty payload is no reading with `decodePayload`, and an all-zero
 *   message with `fieldsOrEmpty` (proto3 leaves zeros out); which one a
 *   topic uses says which it means.
 * - Repeated fields are read with `Fields.repeated`, except the charging
 *   graph's bars, which are checked field by field from their raw bytes.
 * - A topic with `store` and no decoder is kept for decoding; nothing reads
 *   it yet. Every topic's payloads are archived whether or not it's stored.
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
