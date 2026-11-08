import { parse } from 'csv-parse';
import { createReadStream } from 'node:fs';
import type { VehicleState } from '../../rivian/types.js';
import { type LocalTime, TimeZoneClock } from '../imports/time-zone.js';

const KM_PER_MILE = 1.609344;
const MPH_TO_KMH = KM_PER_MILE;
const M_PER_MILE = 1609.344;
/**
 * A tire sensor with nothing to report reads this on every tire: the top of
 * its range (255 steps of 0.025 bar), not a pressure.
 */
const TIRE_NO_READING_BAR = 6.37;

/** Columns that show a file is an ElectraFi export. */
const REQUIRED_COLUMNS = [
  'data_id',
  'Date',
  'state',
  'shift_state',
  'odometer',
  'battery_level',
  'latitude',
  'longitude',
  'charging_state',
  'chargeNumber',
];

/** The state fields an export's rows hold, by RivianMate's names. */
const GEARS: Readonly<Record<string, string>> = {
  P: 'park',
  R: 'reverse',
  N: 'neutral',
  D: 'drive',
};
const TIRES = [
  'tirePressureFrontLeft',
  'tirePressureFrontRight',
  'tirePressureRearLeft',
  'tirePressureRearRight',
];

export type ChargingState = 'Charging' | 'Complete' | 'Disconnected' | null;

export interface ElectraFiRow {
  dataId: number;
  /** The row's time as written: local, with no offset. */
  local: LocalTime;
  /** Whether the vehicle was awake; null when the row doesn't say. */
  asleep: boolean | null;
  gear: string | null;
  speedKmh: number | null;
  mileageM: number | null;
  battery: number | null;
  rangeKm: number | null;
  capacityKwh: number | null;
  /** Bar, in the order of TIRES; null where there's no reading. */
  tires: (number | null)[];
  lat: number | null;
  lon: number | null;
  altitudeM: number | null;
  cabinC: number | null;
  chargeLimit: number | null;
  softwareVersion: string | null;
  driveMode: string | null;
  /** The active driver profile's name, which ElectraFi keeps in Tesla's `autopark_state_v2`. */
  driverName: string | null;
  charging: ChargingState;
  /** ElectraFi's number for the charge; null outside one. */
  chargeNumber: number | null;
  powerKw: number | null;
  energyKwh: number | null;
  rangeAddedKm: number | null;
}

export class NotAnExportError extends Error {
  constructor() {
    super("This doesn't look like an ElectraFi export: its columns are missing.");
  }
}

/** A number from a cell; a blank is no reading, not zero. */
function num(cell: string | undefined): number | null {
  if (cell == null || cell.trim() === '') return null;
  const n = Number(cell);
  return Number.isFinite(n) ? n : null;
}

const text = (cell: string | undefined): string | null => cell?.trim() || null;
const round = (n: number | null, places: number): number | null =>
  n == null ? null : Math.round(n * 10 ** places) / 10 ** places;
const times = (n: number | null, by: number): number | null => (n == null ? null : n * by);

/** Exports write `2026-10-29 8:02:08`, with the hour unpadded in the morning. */
export function parseLocalTime(value: string | undefined): LocalTime | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/.exec(value?.trim() ?? '');
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

function parseTires(cell: string | undefined): (number | null)[] {
  const parts = cell?.trim().split(/\s+/) ?? [];
  return TIRES.map((_, i) => {
    const bar = num(parts[i]);
    return bar == null || bar >= TIRE_NO_READING_BAR ? null : bar;
  });
}

function coordinate(cell: string | undefined, limit: number): number | null {
  const n = num(cell);
  return n != null && Math.abs(n) <= limit ? n : null;
}

/** One row of an export, in RivianMate's units; null without a readable id and date. */
export function parseRow(cells: Record<string, string>): ElectraFiRow | null {
  const dataId = num(cells['data_id']);
  const local = parseLocalTime(cells['Date']);
  if (dataId == null || !local) return null;
  const chargeNumber = num(cells['chargeNumber']);
  const charging = text(cells['charging_state']);
  const lat = coordinate(cells['latitude'], 90);
  const lon = coordinate(cells['longitude'], 180);
  const vehicleState = text(cells['state']);
  return {
    dataId,
    local,
    asleep: vehicleState === 'asleep' ? true : vehicleState === 'online' ? false : null,
    gear: GEARS[cells['shift_state']?.trim() ?? ''] ?? null,
    speedKmh: round(times(num(cells['speed']), MPH_TO_KMH), 2),
    mileageM: round(times(num(cells['odometer']), M_PER_MILE), 0),
    battery: num(cells['battery_level']),
    rangeKm: round(times(num(cells['battery_range']), KM_PER_MILE), 3),
    capacityKwh: num(cells['backseat_token']),
    tires: parseTires(cells['id_s']),
    lat: lat != null && lon != null ? lat : null,
    lon: lat != null && lon != null ? lon : null,
    altitudeM: num(cells['elevation']),
    cabinC: num(cells['inside_temp']),
    chargeLimit: num(cells['charge_limit_soc']),
    softwareVersion: text(cells['car_version']),
    driveMode: text(cells['spoiler_type']),
    driverName: text(cells['autopark_state_v2']),
    charging:
      charging === 'Charging' || charging === 'Complete' || charging === 'Disconnected'
        ? charging
        : null,
    chargeNumber: chargeNumber ? chargeNumber : null,
    powerKw: round(num(cells['charger_power']), 2),
    energyKwh: round(num(cells['charge_energy_added']), 2),
    rangeAddedKm: round(times(num(cells['charge_miles_added_rated']), KM_PER_MILE), 3),
  };
}

const CHARGER: Readonly<
  Record<NonNullable<ChargingState>, { chargerState: string; chargerStatus: string }>
> = {
  Charging: { chargerState: 'charging_active', chargerStatus: 'chrgr_sts_connected_charging' },
  Complete: { chargerState: 'charging_complete', chargerStatus: 'chrgr_sts_connected_no_chrg' },
  // What Rivian reports once a vehicle is unplugged.
  Disconnected: { chargerState: 'charging_ready', chargerStatus: 'chrgr_sts_not_connected' },
};

/**
 * A row's readings as vehicle state, with Rivian's field names, stamped at
 * `at`. Blanks are left out: a row only says what it has a reading for.
 */
export function rowState(row: ElectraFiRow, at: number): VehicleState {
  const timeStamp = new Date(at).toISOString();
  const state: VehicleState = {};
  const put = (field: string, value: string | number | null) => {
    if (value != null) state[field] = { value, timeStamp };
  };
  // Rivian's values for each: History tells awake from asleep by this.
  if (row.asleep != null) {
    const moving = row.gear === 'drive' || row.gear === 'reverse';
    put('powerState', row.asleep ? 'sleep' : moving ? 'go' : 'ready');
  }
  put('gearStatus', row.gear);
  put('vehicleMileage', row.mileageM);
  put('batteryLevel', row.battery);
  put('distanceToEmpty', row.rangeKm);
  put('batteryCapacity', row.capacityKwh);
  put('batteryLimit', row.chargeLimit);
  put('cabinClimateInteriorTemperature', row.cabinC);
  put('otaCurrentVersion', row.softwareVersion);
  put('driveMode', row.driveMode);
  TIRES.forEach((field, i) => put(field, row.tires[i] ?? null));
  if (row.charging) {
    put('chargerState', CHARGER[row.charging].chargerState);
    put('chargerStatus', CHARGER[row.charging].chargerStatus);
  }
  return state;
}

/** Every field `rowState` can write. */
export const ROW_STATE_FIELDS: readonly string[] = [
  'powerState',
  'gearStatus',
  'vehicleMileage',
  'batteryLevel',
  'distanceToEmpty',
  'batteryCapacity',
  'batteryLimit',
  'cabinClimateInteriorTemperature',
  'otaCurrentVersion',
  'driveMode',
  ...TIRES,
  'chargerState',
  'chargerStatus',
];

/** Raises NotAnExportError unless the header has the columns an export has. */
export function assertExportHeader(columns: readonly string[]): void {
  if (!REQUIRED_COLUMNS.every((c) => columns.includes(c))) throw new NotAnExportError();
}

function csvRecords(path: string) {
  return createReadStream(path).pipe(
    parse({
      bom: true,
      columns: (header: string[]) => {
        assertExportHeader(header);
        return header;
      },
      relax_column_count: true,
      skip_empty_lines: true,
    }),
  );
}

/** The first data_id in a file, which orders a month's files against each other. */
export async function firstDataId(path: string): Promise<number> {
  const records = csvRecords(path);
  try {
    for await (const cells of records as AsyncIterable<Record<string, string>>) {
      const row = parseRow(cells);
      if (row) return row.dataId;
    }
    return Infinity;
  } finally {
    records.destroy();
  }
}

export interface ReadStats {
  unreadable: number;
}

/**
 * The rows of an export's files in order, each once, with its instant. Files
 * may overlap, so a row at or before the last data_id seen is dropped.
 */
export async function* readRows(
  paths: readonly string[],
  timeZone: string,
  stats: ReadStats = { unreadable: 0 },
): AsyncGenerator<{ row: ElectraFiRow; at: number }> {
  const clock = new TimeZoneClock(timeZone);
  const ordered = (
    await Promise.all(paths.map(async (path) => ({ path, first: await firstDataId(path) })))
  ).sort((a, b) => a.first - b.first);
  let lastId = -Infinity;
  for (const { path } of ordered) {
    for await (const cells of csvRecords(path) as AsyncIterable<Record<string, string>>) {
      const row = parseRow(cells);
      if (!row) {
        stats.unreadable += 1;
        continue;
      }
      if (row.dataId <= lastId) continue;
      lastId = row.dataId;
      yield { row, at: clock.next(row.local) };
    }
  }
}
