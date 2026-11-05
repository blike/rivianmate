import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../logger.js';
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
    silentLogger,
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
  const at = (timeStamp: string, value: number) => ({ timeStamp, value });

  /** A monitor with one vehicle, and its deltas as monitor.handleDelta would take them. */
  function oneVehicle() {
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
    return { monitor, delta };
  }

  it('uses Parallax’s odometer only where legacy has none', async () => {
    const { monitor, delta } = oneVehicle();
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

  const fix = (timeStamp: string) => ({ latitude: 40.5, longitude: -89, timeStamp });
  const navOf = (monitor: ReturnType<typeof oneVehicle>['monitor']) =>
    monitor.getState('v1')?.navLocation;
  /** Legacy reporting its own fix at each of `stamps`. */
  const legacyFixes = async (
    delta: ReturnType<typeof oneVehicle>['delta'],
    stamps: readonly string[],
  ) => {
    for (const timeStamp of stamps) await delta('v1', { gnssLocation: fix(timeStamp) }, 'legacy');
  };

  it('keeps the navigation fix while legacy has only reported one fix', async () => {
    const { monitor, delta } = oneVehicle();
    // Startup: one legacy fix says nothing about how often legacy reports.
    await legacyFixes(delta, ['2026-10-13T12:00:00Z']);
    await delta('v1', { navLocation: fix('2026-10-13T12:00:03Z') }, 'parallax');
    expect(navOf(monitor)).toEqual(fix('2026-10-13T12:00:03Z'));
  });

  it('keeps the navigation fix on a car whose own fixes come once a minute', async () => {
    const { monitor, delta } = oneVehicle();
    // An R2: legacy's own fix arrives about once a minute, so it is no track to
    // defer to, and the navigation fix keeps being used.
    await legacyFixes(delta, ['2026-10-13T12:00:00Z', '2026-10-13T12:01:00Z']);
    await delta('v1', { navLocation: fix('2026-10-13T12:01:03Z') }, 'parallax');
    expect(navOf(monitor)).toEqual(fix('2026-10-13T12:01:03Z'));
  });

  it('does not take one short gap for a track of its own', async () => {
    const { monitor, delta } = oneVehicle();
    // A wake-up burst: a minute apart, then ten seconds.
    await legacyFixes(delta, [
      '2026-10-13T12:00:00Z',
      '2026-10-13T12:01:00Z',
      '2026-10-13T12:01:10Z',
    ]);
    await delta('v1', { navLocation: fix('2026-10-13T12:01:11Z') }, 'parallax');
    expect(navOf(monitor)).toEqual(fix('2026-10-13T12:01:11Z'));
  });

  it('refuses navigation fixes once legacy reports one every few seconds', async () => {
    const { monitor, delta } = oneVehicle();
    await delta('v1', { navLocation: fix('2026-10-13T11:59:59Z') }, 'parallax');
    expect(navOf(monitor)).toEqual(fix('2026-10-13T11:59:59Z'));

    // An R1: legacy is a five-second track of its own, so the navigation one
    // adds nothing. The fix held from before stays; the writer only uses it
    // for the moment it was taken.
    await legacyFixes(delta, [
      '2026-10-13T12:00:00Z',
      '2026-10-13T12:00:05Z',
      '2026-10-13T12:00:10Z',
    ]);
    await delta('v1', { navLocation: fix('2026-10-13T12:00:11Z') }, 'parallax');
    expect(navOf(monitor)).toEqual(fix('2026-10-13T11:59:59Z'));
  });

  it('does not take a re-sent legacy fix for a faster feed', async () => {
    const { monitor, delta } = oneVehicle();
    // The same fix three times: no cadence at all, so nothing to defer to.
    await legacyFixes(delta, [
      '2026-10-13T12:00:00Z',
      '2026-10-13T12:00:00Z',
      '2026-10-13T12:00:00Z',
    ]);
    await delta('v1', { navLocation: fix('2026-10-13T12:00:03Z') }, 'parallax');
    expect(navOf(monitor)).toEqual(fix('2026-10-13T12:00:03Z'));
  });

  it('keeps a navigation fix older than the last legacy one, on a slow feed', async () => {
    const { monitor, delta } = oneVehicle();
    // A minute apart, so legacy is no track: a fix stamped before legacy's own
    // still stands (the writer decides whether it is current).
    await legacyFixes(delta, ['2026-10-13T12:00:00Z', '2026-10-13T12:01:00Z']);
    await delta('v1', { navLocation: fix('2026-10-13T12:00:59Z') }, 'parallax');
    expect(navOf(monitor)).toEqual(fix('2026-10-13T12:00:59Z'));
  });

  it('counts three legacy fixes within 30 s as a track, and not a millisecond more', async () => {
    const { monitor, delta } = oneVehicle();
    await legacyFixes(delta, [
      '2026-10-13T12:00:00Z',
      '2026-10-13T12:00:10Z',
      '2026-10-13T12:00:20Z',
    ]);
    await delta('v1', { navLocation: fix('2026-10-13T12:00:30Z') }, 'parallax');
    expect(navOf(monitor)).toBeUndefined();
    await delta('v1', { navLocation: fix('2026-10-13T12:00:30.001Z') }, 'parallax');
    expect(navOf(monitor)).toEqual(fix('2026-10-13T12:00:30.001Z'));
  });

  it('goes back to the navigation fix within 30 s of a wake-up burst', async () => {
    const { monitor, delta } = oneVehicle();
    // An R2 waking: three quick fixes, then its usual minute between them.
    await legacyFixes(delta, [
      '2026-10-13T12:00:00Z',
      '2026-10-13T12:00:02Z',
      '2026-10-13T12:00:04Z',
    ]);
    await delta('v1', { navLocation: fix('2026-10-13T12:00:10Z') }, 'parallax');
    expect(navOf(monitor)).toBeUndefined();
    await delta('v1', { navLocation: fix('2026-10-13T12:00:31Z') }, 'parallax');
    expect(navOf(monitor)).toEqual(fix('2026-10-13T12:00:31Z'));
  });

  it('goes back to the navigation fix when a dense legacy feed goes quiet', async () => {
    const { monitor, delta } = oneVehicle();
    await legacyFixes(delta, [
      '2026-10-13T12:00:00Z',
      '2026-10-13T12:00:05Z',
      '2026-10-13T12:00:10Z',
    ]);
    // Twenty-one seconds after its last fix, it no longer has three in 30 s.
    await delta('v1', { navLocation: fix('2026-10-13T12:00:31Z') }, 'parallax');
    expect(navOf(monitor)).toEqual(fix('2026-10-13T12:00:31Z'));
  });
});
