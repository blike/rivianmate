/** Builds export rows for tests, in the shape ElectraFi writes them. */
const COLUMNS = [
  'data_id',
  'Date',
  'state',
  'shift_state',
  'speed',
  'odometer',
  'battery_level',
  'battery_range',
  'backseat_token',
  'id_s',
  'latitude',
  'longitude',
  'elevation',
  'inside_temp',
  'charge_limit_soc',
  'car_version',
  'spoiler_type',
  'charging_state',
  'chargeNumber',
  'charger_power',
  'charge_energy_added',
  'charge_miles_added_rated',
];

export type TestRow = Partial<Record<(typeof COLUMNS)[number], string | number>>;

const BOM = String.fromCharCode(0xfeff);

let nextId = 1;

export function csvOf(rows: readonly TestRow[]): string {
  const lines = rows.map((row) =>
    COLUMNS.map((c) => (c === 'data_id' ? (row[c] ?? nextId++) : (row[c] ?? ''))).join(','),
  );
  return `${BOM}${COLUMNS.join(',')}\n${lines.join('\n')}\n`;
}

/** Awake and parked unless told otherwise, at a made-up place. */
export const awake = (date: string, row: TestRow = {}): TestRow => ({
  Date: date,
  state: 'online',
  shift_state: 'P',
  speed: 0,
  odometer: 1000,
  battery_level: 60,
  battery_range: 200,
  backseat_token: 111,
  id_s: '3.3 3.35 3.25 3.3',
  latitude: 10,
  longitude: 20,
  inside_temp: 22,
  charge_limit_soc: 70,
  car_version: '2026.36.01',
  spoiler_type: 'everyday',
  charging_state: 'Disconnected',
  chargeNumber: 0,
  ...row,
});

export const asleep = (date: string): TestRow => ({ Date: date, state: 'asleep', chargeNumber: 0 });

/** A drive like a real one: parked, off across a poll or two, parked again. */
export function driveRows(day = '2026-10-30'): TestRow[] {
  return [
    awake(`${day} 12:52:07`, {
      odometer: 5218.852775771999,
      battery_level: 58.2,
      battery_range: 195.110494,
    }),
    awake(`${day} 12:53:07`, {
      shift_state: 'D',
      speed: 25.12,
      odometer: 5218.905592307,
      battery_level: 58.29,
      battery_range: 195.110494,
      elevation: 50.7,
    }),
    awake(`${day} 12:58:07`, {
      shift_state: 'D',
      speed: 36.57,
      odometer: 5220.908892411,
      battery_level: 58,
      battery_range: 193.246381,
      latitude: 10.03,
      longitude: 20.01,
      elevation: 6.5,
    }),
    awake(`${day} 13:04:07`, {
      speed: 24.98,
      odometer: 5222.485932009,
      battery_level: 57.2,
      battery_range: 190.760897,
      latitude: 10.03,
      longitude: 20.01,
      elevation: 53.8,
    }),
    awake(`${day} 13:05:07`, {
      odometer: 5222.492145719,
      battery_level: 57.2,
      battery_range: 190.760897,
      latitude: 10.04,
      longitude: 20.02,
    }),
    awake(`${day} 13:06:07`, {
      odometer: 5222.492145719,
      battery_level: 57.2,
      battery_range: 190.760897,
      latitude: 10.04,
      longitude: 20.02,
    }),
    awake(`${day} 13:08:07`, {
      odometer: 5222.492145719,
      battery_level: 57.2,
      battery_range: 190.760897,
      latitude: 10.04,
      longitude: 20.02,
    }),
  ];
}

/** A charge of `minutes`, one row a minute, ending unplugged with the last power showing. */
export function chargeRows(start: Date, minutes: number, number: number, firstKwh = 0): TestRow[] {
  const stamp = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  const rows: TestRow[] = [];
  for (let i = 0; i <= minutes; i++) {
    rows.push(
      awake(stamp(new Date(start.getTime() + i * 60_000)), {
        charging_state: i === minutes ? 'Disconnected' : 'Charging',
        chargeNumber: number,
        charger_power: 6,
        charge_energy_added: firstKwh + i * 0.1,
        charge_miles_added_rated: firstKwh * 2 + i * 0.2,
        battery_level: 50 + i * 0.05,
      }),
    );
  }
  return rows;
}
