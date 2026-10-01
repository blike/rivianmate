/**
 * Records Rivian's Parallax charging messages to an NDJSON file, using the
 * Rivian session RivianMate already stored. Read-only: it opens its own
 * socket (the running app keeps its own) and changes nothing in the
 * database. Run it while the vehicle charges, for real samples to check
 * the protobuf decoding against.
 *
 *   DATABASE_URL=postgres://… pnpm --filter @rivianmate/server parallax:capture [minutes]
 *
 * APP_SECRET and DATABASE_URL come from the environment or ../.env.
 * Writes parallax-capture-<time>.ndjson in the current directory.
 */
import { appendFileSync } from "node:fs";
import { TokenCrypto } from "../src/crypto.js";
import { createDb } from "../src/db/client.js";
import { vehicles } from "../src/db/schema.js";
import { RivianClient } from "../src/rivian/client.js";
import { RivianGovernor } from "../src/rivian/governor.js";
import {
  PARALLAX_CHARGING_RVMS,
  type ProtoField,
  RVM_CHARGING_GRAPH,
  decodeChargingGraph,
  readProtoFields,
} from "../src/rivian/parallax.js";
import { RivianSubscriptionManager } from "../src/rivian/subscription.js";
import { TokenStore } from "../src/services/token-store.js";

const minutes = Number(process.argv[2] ?? 60);
const { APP_SECRET, DATABASE_URL } = process.env;
if (!APP_SECRET || !DATABASE_URL) {
  console.error("Set APP_SECRET and DATABASE_URL (e.g. postgres://rivianmate:…@localhost:5433/rivianmate).");
  process.exit(1);
}

/** Nested protobuf dump, e.g. `1:{1:58.2(f64) 2:125.1(f64)} 4:2`. */
function describe(fields: ProtoField[], depth = 0): string {
  return fields
    .map((f) => {
      if (f.wire === 0) return `${f.field}:${f.value}`;
      const view = new DataView(f.value.buffer, f.value.byteOffset, f.value.byteLength);
      if (f.wire === 5) return `${f.field}:${round(view.getFloat32(0, true))}(f32)`;
      if (f.wire === 1) return `${f.field}:${round(view.getFloat64(0, true))}(f64)`;
      const nested = depth < 4 ? readProtoFields(f.value) : null;
      if (nested && nested.length > 0) return `${f.field}:{${describe(nested, depth + 1)}}`;
      const text = Buffer.from(f.value).toString("utf8");
      return /^[\x20-\x7e]*$/.test(text) ? `${f.field}:"${text}"` : `${f.field}:<${f.value.length} bytes>`;
    })
    .join(" ");
}
const round = (n: number) => Math.round(n * 1000) / 1000;

const { db, sql } = createDb(DATABASE_URL);
const account = await new TokenStore(db, new TokenCrypto(APP_SECRET)).load();
const [vehicle] = await db.select({ id: vehicles.id, model: vehicles.model }).from(vehicles).limit(1);
await sql.end();
if (!account || !vehicle) {
  console.error("No Rivian account or vehicle stored; connect RivianMate to Rivian first.");
  process.exit(1);
}

const governor = new RivianGovernor();
const client = new RivianClient({ governor, tokens: account.tokens });
await client.createCsrfToken();

const file = `parallax-capture-${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson`;
const stream = new RivianSubscriptionManager({
  governor,
  getCredentials: () => ({ userSessionToken: client.userSessionToken, appSession: client.appSession }),
  log: (msg) => console.log(`[stream] ${msg}`),
});
stream.onAuthenticated = () => console.log(`Connected. Recording ${vehicle.model ?? "vehicle"} for ${minutes} min → ${file}`);

let count = 0;
stream.subscribeParallax(vehicle.id, PARALLAX_CHARGING_RVMS, (_id, message) => {
  count += 1;
  const bytes = Buffer.from(message.payload, "base64");
  const fields = readProtoFields(bytes);
  const graph = message.rvm === RVM_CHARGING_GRAPH ? decodeChargingGraph(message.payload) : undefined;
  appendFileSync(
    file,
    `${JSON.stringify({ receivedAt: new Date().toISOString(), ...message, raw: fields ? describe(fields) : null, graph })}\n`,
  );
  const summary = graph
    ? `${graph.length} bars, last ${graph.at(-1)?.soc ?? "?"}% @ ${round(graph.at(-1)?.powerKw ?? 0)} kW`
    : fields
      ? describe(fields).slice(0, 160)
      : `<${bytes.length} bytes, not protobuf>`;
  console.log(`${new Date().toLocaleTimeString()} ${message.rvm}: ${summary}`);
});

stream.start();
setTimeout(() => {
  console.log(`Done: ${count} messages${stream.isUnsupported("parallax") ? " (Rivian rejected the subscription)" : ""}.`);
  stream.stop();
  process.exit(0);
}, minutes * 60_000);
