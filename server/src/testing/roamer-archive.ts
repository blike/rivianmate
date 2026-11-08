import { crc32 } from 'node:zlib';

/** A zip of the files, stored uncompressed: enough for the reader under test. */
export function zipOf(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export const ROAMER_VEHICLE = 'rv1';
export const ROAMER_VIN = 'TESTVIN0000000001';

const lines = (records: readonly object[]) => records.map((r) => JSON.stringify(r)).join('\n');

/**
 * A Roamer export for one vehicle: the datasets given, by name, listed in a
 * manifest as Roamer lists them. Telemetry goes in one dated file each, and
 * the account's places at the top.
 */
export function roamerExport(
  datasets: Partial<Record<string, readonly object[]>>,
  vin = ROAMER_VIN,
): Buffer {
  const telemetry = [
    'vehicle_metrics',
    'location_metrics',
    'charging_metrics',
    'navigation_metrics',
  ];
  const account = ['saved_places', 'rivian_favorites'];
  const files: Record<string, string> = {
    'vehicles.jsonl': lines([{ id: ROAMER_VEHICLE, vin, name: 'Test', model: 'R1S' }]),
  };
  const listed: Record<string, { dataset: string; rows: number }> = {
    'vehicles.jsonl': { dataset: 'vehicles', rows: 1 },
  };
  for (const [dataset, records] of Object.entries(datasets)) {
    const name = account.includes(dataset)
      ? `${dataset}.jsonl`
      : telemetry.includes(dataset)
        ? `vehicles/${ROAMER_VEHICLE}/${dataset}/20260101T000000.jsonl`
        : `vehicles/${ROAMER_VEHICLE}/${dataset}.jsonl`;
    files[name] = lines(records ?? []);
    listed[name] = { dataset, rows: records?.length ?? 0 };
  }
  files['manifest.json'] = JSON.stringify({ format_version: 1, files: listed });
  return zipOf(files);
}
