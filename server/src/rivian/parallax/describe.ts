import { rvmDef } from './registry.js';
import { f32, type ParallaxMessage, type ProtoField, readProtoFields } from './wire.js';

export interface RawField {
  /** "3.1" is field 1 inside field 3; repeated fields get an index, as in "2[1].3". */
  path: string;
  /** What RivianMate reads the field as; null when it doesn't use it. */
  name: string | null;
  value: number | string;
}

/**
 * Every field of a message, flattened, with RivianMate's name for those it
 * reads. Rivian sends no schema, so a field's type is a best guess from its
 * wire type: varints as integers, 32-bit as float, 64-bit as double, and
 * length-delimited as a nested message, text, or base64 bytes.
 */
export function describeParallax(message: ParallaxMessage): RawField[] {
  if (!message.payload) return [];
  const def = rvmDef(message.rvm);
  const names = def?.fieldNames ?? {};
  const entries = def?.entryLabels;
  const nameOf = (segments: string[]) =>
    Object.entries(names).find(([key]) => {
      const parts = key.split('.');
      return (
        parts.length === segments.length && parts.every((p, i) => p === '*' || p === segments[i])
      );
    })?.[1] ?? null;
  const namedBelow = (segments: string[]) =>
    Object.keys(names).some((key) => {
      const parts = key.split('.');
      return (
        parts.length > segments.length &&
        segments.every((s, i) => parts[i] === '*' || parts[i] === s)
      );
    });

  // "Closure: state" in the front left door's entry reads "Driver door: state".
  const relabel = (name: string | null, label: string | null) => {
    if (!name || !label) return name;
    const colon = name.indexOf(': ');
    return `${label}: ${colon < 0 ? name : name.slice(colon + 2)}`;
  };

  const rows: RawField[] = [];
  const walk = (
    fields: ProtoField[],
    path: string,
    segments: string[],
    depth: number,
    label: string | null = null,
  ) => {
    const counts = new Map<number, number>();
    for (const f of fields) counts.set(f.field, (counts.get(f.field) ?? 0) + 1);
    const seen = new Map<number, number>();
    for (const f of fields) {
      const index = seen.get(f.field) ?? 0;
      seen.set(f.field, index + 1);
      const here = `${path}${path ? '.' : ''}${f.field}${counts.get(f.field)! > 1 ? `[${index}]` : ''}`;
      const at = [...segments, String(f.field)];
      const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
      if (f.wire === 0) {
        rows.push({
          path: here,
          name: relabel(nameOf(at), label),
          value: Number(BigInt.asIntN(64, f.value)),
        });
      } else if (f.wire === 1) {
        rows.push({
          path: here,
          name: relabel(nameOf(at), label),
          value: view(f.value).getFloat64(0, true),
        });
      } else if (f.wire === 5) {
        rows.push({
          path: here,
          name: relabel(nameOf(at), label),
          value: f32(view(f.value).getFloat32(0, true))!,
        });
      } else {
        const text = Buffer.from(f.value).toString('utf8');
        // Valid UTF-8 without control characters reads as text (addresses can be non-ASCII).
        const printable = ![...text].some((c) => {
          const code = c.codePointAt(0)!;
          return code < 0x20 || code === 0x7f || code === 0xfffd;
        });
        const nested = depth < 8 && f.value.length > 0 ? readProtoFields(f.value) : null;
        // A message whose bytes happen to be printable stays a message if names sit below it.
        const entryLabel =
          nested && depth === 0 && f.field === entries?.field
            ? (entries.labels[entryKey(nested, entries.key) ?? -1] ?? null)
            : label;
        if (nested && (!printable || namedBelow(at))) walk(nested, here, at, depth + 1, entryLabel);
        else
          rows.push({
            path: here,
            name: relabel(nameOf(at), label),
            value: printable ? text : `bytes ${Buffer.from(f.value).toString('base64')}`,
          });
      }
    }
  };
  const fields = readProtoFields(Buffer.from(message.payload, 'base64'));
  if (fields) walk(fields, '', [], 0);
  else rows.push({ path: '', name: null, value: `undecodable ${message.payload}` });
  return rows;
}

/** The integer in a field of an entry, as its label key. */
function entryKey(fields: ProtoField[], key: number): number | null {
  const f = fields.find((x) => x.field === key);
  return f?.wire === 0 ? Number(BigInt.asIntN(64, f.value)) : null;
}
