import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../logger.js';
import {
  type Decoded,
  RVM_GEAR,
  RVM_TRIP_INFO,
  type TripInfo,
  tripInfo,
} from '../rivian/parallax/index.js';
import { b64, int } from '../testing/protobuf.js';
import { ParallaxRouter } from './parallax-router.js';

const AT = Date.parse('2026-10-12T13:58:09Z');

describe('ParallaxRouter', () => {
  it('decodes once and hands legacy fields on with Rivian’s time', () => {
    const seen: (Decoded | null)[] = [];
    const deltas: unknown[] = [];
    new ParallaxRouter()
      .on((_id, decoded) => seen.push(decoded))
      .onState((id, delta) => deltas.push([id, delta]))
      .dispatch('v1', { rvm: RVM_GEAR, payload: b64(int(1, 4)), timestamp: AT / 1000 });
    expect(seen[0]?.value).toEqual({ gearStatus: 'drive' });
    expect(deltas).toEqual([
      ['v1', { gearStatus: { timeStamp: new Date(AT).toISOString(), value: 'drive' } }],
    ]);
  });

  it('gives a topic’s handlers its value, null when the message is empty', () => {
    const trips: (TripInfo | null)[] = [];
    new ParallaxRouter()
      .onTopic(tripInfo, (_id, trip) => trips.push(trip))
      .dispatch('v1', { rvm: RVM_TRIP_INFO, payload: '', timestamp: null });
    expect(trips).toEqual([null]);
  });

  it('passes unknown topics through undecoded, without state', () => {
    const seen: (Decoded | null)[] = [];
    const state = vi.fn();
    new ParallaxRouter()
      .on((_id, decoded) => seen.push(decoded))
      .onState(state)
      .dispatch('v1', { rvm: 'some.new.topic', payload: b64(int(1, 1)), timestamp: null });
    expect(seen).toEqual([null]);
    expect(state).not.toHaveBeenCalled();
  });

  it('keeps going when a handler throws or rejects', async () => {
    const error = vi.fn();
    const state = vi.fn();
    new ParallaxRouter({ error } as unknown as Logger)
      .on(() => {
        throw new Error('boom');
      })
      .on(() => Promise.reject(new Error('later')))
      .onState(state)
      .dispatch('v1', { rvm: RVM_GEAR, payload: b64(int(1, 1)), timestamp: null });
    await Promise.resolve();
    expect(state).toHaveBeenCalledOnce();
    const messages = error.mock.calls.map(([fields]) => (fields as { err: Error }).err.message);
    expect(messages).toEqual(['boom', 'later']);
  });
});
