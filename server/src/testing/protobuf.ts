import { b64, float, int, message } from "../rivian/protobuf-encode.js";

export { b64, double, float, int, message, string } from "../rivian/protobuf-encode.js";

/** A `k70/g` charging graph bar. */
export const graphBar = (soc: number, kw: number, startMs: number, endMs: number) => [
  ...int(1, soc),
  ...float(2, kw),
  ...int(3, startMs),
  ...int(4, endMs),
  ...int(6, 3),
];

/** A `charging_graph_global` payload made of the given bars. */
export const chargingGraph = (...bars: number[][]) => b64(bars.flatMap((bar) => message(1, bar)));
