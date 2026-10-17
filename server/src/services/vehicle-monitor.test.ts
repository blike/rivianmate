import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { RivianApiError, RivianUnauthenticatedError } from '../rivian/types.js';
import { LiveBus } from './live-bus.js';
import type { TokenStore } from './token-store.js';
import { VehicleMonitor, type RivianConnection } from './vehicle-monitor.js';

function setup(error: Error) {
  const store = {
    load: vi.fn().mockResolvedValue({ authState: 'ok', tokens: {} }),
    setAuthState: vi.fn().mockResolvedValue(undefined),
  };
  const stream = { stop: vi.fn() };
  const connection = {
    api: { getUserInfo: vi.fn().mockRejectedValue(error) },
    stream,
  } as unknown as RivianConnection;
  const monitor = new VehicleMonitor(
    {} as Db,
    store as unknown as TokenStore,
    new LiveBus(),
    () => connection,
    vi.fn(),
  );
  return { monitor, store, stream, connection };
}

describe('monitor startup failure', () => {
  it('requests re-login and reports disconnected when stored credentials are rejected', async () => {
    const { monitor, store, stream } = setup(
      new RivianUnauthenticatedError('User is unauthenticated'),
    );
    await expect(monitor.startIfConfigured()).resolves.toBe('needs_login');
    expect(monitor.isRunning).toBe(false);
    expect(store.setAuthState).toHaveBeenCalledWith('unauthenticated');
    expect(stream.stop).toHaveBeenCalledOnce();
  });

  it('cleans up transient failures without invalidating stored credentials', async () => {
    const error = new RivianApiError('Network unavailable');
    const { monitor, store, stream } = setup(error);
    await expect(monitor.startIfConfigured()).rejects.toBe(error);
    expect(monitor.isRunning).toBe(false);
    expect(store.setAuthState).not.toHaveBeenCalled();
    expect(stream.stop).toHaveBeenCalledOnce();
  });

  it('also cleans up failures during a fresh connect', async () => {
    const error = new RivianUnauthenticatedError('User is unauthenticated');
    const { monitor, store, connection } = setup(error);
    await expect(monitor.start(connection)).rejects.toBe(error);
    expect(monitor.isRunning).toBe(false);
    expect(store.setAuthState).toHaveBeenCalledWith('unauthenticated');
  });
});

describe('per-vehicle Parallax diagnostics', () => {
  it('reports mixed capabilities independently of vehicle ordering', () => {
    const { monitor } = setup(new Error('unused'));
    const vehicles = monitor.getVehicles();
    const common = { vin: 'VIN', name: null, make: null, model: null, modelYear: null };
    vehicles.push(
      { ...common, id: 'parallax', supportedFeatures: ['VEHICLE_CONNECTIVITY_PARALLAX'] },
      { ...common, id: 'classic', supportedFeatures: [] },
    );
    const expected = { parallax: 'parallax', classic: 'classic' };
    expect(monitor.diagnostics().parallaxModes).toEqual(expected);
    expect(monitor.diagnostics().parallaxMode).toBe('parallax');
    vehicles.reverse();
    expect(monitor.diagnostics().parallaxModes).toEqual(expected);
    expect(monitor.diagnostics().parallaxMode).toBe('parallax');
    vehicles.splice(0);
    expect(monitor.diagnostics().parallaxModes).toEqual({});
    expect(monitor.diagnostics().parallaxMode).toBe('classic');
  });
});

describe('legacy-preferred fields', () => {
  it('uses Parallax’s odometer only where legacy has none', async () => {
    const { monitor } = setup(new Error('unused'));
    monitor.getVehicles().push({
      id: 'v1',
      vin: 'VIN',
      name: null,
      make: null,
      model: null,
      modelYear: null,
      supportedFeatures: [],
    });
    const delta = (
      monitor as unknown as {
        handleDelta(id: string, d: object, source: 'legacy' | 'parallax'): Promise<void>;
      }
    ).handleDelta.bind(monitor);
    const at = (timeStamp: string, value: number) => ({ timeStamp, value });
    const mileage = () => monitor.getState('v1')?.vehicleMileage;

    // No legacy reading yet (an R2): Parallax's whole km stand in.
    await delta('v1', { vehicleMileage: at('2026-10-13T12:00:00Z', 1_000_000) }, 'parallax');
    expect(mileage()).toEqual(at('2026-10-13T12:00:00Z', 1_000_000));
    // Legacy's metres replace it, though stamped earlier.
    await delta('v1', { vehicleMileage: at('2026-10-13T11:59:00Z', 1_000_400) }, 'legacy');
    expect(mileage()).toEqual(at('2026-10-13T11:59:00Z', 1_000_400));
    // And Parallax no longer replaces legacy's.
    await delta('v1', { vehicleMileage: at('2026-10-13T12:05:00Z', 1_001_000) }, 'parallax');
    expect(mileage()).toEqual(at('2026-10-13T11:59:00Z', 1_000_400));
  });
});
