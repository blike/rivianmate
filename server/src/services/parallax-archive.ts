import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { and, asc, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { parallaxArchive, parallaxChunks } from '../db/schema.js';
import { type Logger, silentLogger } from '../logger.js';
import { type ParallaxMessage, messageTime } from '../rivian/parallax/index.js';
import type { HistoryKeys } from './history-keys.js';

/** Payloads stay a row each this long, then are packed by hour. */
export const ARCHIVE_ROWS_MS = 30 * 24 * 3600_000;
const HOUR_MS = 3600_000;
/** Hours packed per roll-up pass, so one pass never holds the database long. */
const ROLL_UP_BATCH = 500;
const CHUNK_FORMAT = 1;

export interface ArchivedMessage {
  at: Date;
  /** Base64, as Rivian sends it. */
  payload: string;
}

interface Entry {
  at: number;
  payload: Buffer;
}

/**
 * Every distinct payload of every Parallax topic, kept raw for good, so a
 * better decoder (or one for a field nobody reads yet) applies to all of
 * history. Repeats of a topic's last payload aren't kept. Payloads are a
 * row each for 30 days, then rolled up into one compressed chunk per
 * vehicle, topic and hour; `messages` reads both.
 */
export class ParallaxArchive {
  /** The last archived payload per vehicle and topic, once loaded. */
  private lastPayload = new Map<string, string | null>();
  private queues = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly keys: HistoryKeys,
    private readonly log: Logger = silentLogger,
    private readonly now: () => number = Date.now,
  ) {}

  /** Archives a message unless it repeats its topic's last payload. Never throws. */
  ingest(vehicleId: string, message: ParallaxMessage): Promise<void> {
    const received = this.now();
    const run = (this.queues.get(vehicleId) ?? Promise.resolve())
      .then(() => this.write(vehicleId, message, received))
      .catch((err: unknown) =>
        this.log.error({ err, rvm: message.rvm, vehicleId }, 'archiving message failed'),
      );
    this.queues.set(vehicleId, run);
    return run;
  }

  private async write(vehicleId: string, message: ParallaxMessage, received: number) {
    const seq = await this.keys.vehicleSeq(vehicleId);
    if (seq === null) return;
    const topicId = (await this.keys.topicIds([message.rvm])).get(message.rvm)!;
    const key = `${seq}|${topicId}`;
    if (!this.lastPayload.has(key)) {
      const [row] = await this.db
        .select({ payload: parallaxArchive.payload })
        .from(parallaxArchive)
        .where(and(eq(parallaxArchive.vehicleSeq, seq), eq(parallaxArchive.topicId, topicId)))
        .orderBy(desc(parallaxArchive.at))
        .limit(1);
      this.lastPayload.set(key, row ? row.payload.toString('base64') : null);
    }
    if (this.lastPayload.get(key) === message.payload) return;
    await this.db.insert(parallaxArchive).values({
      vehicleSeq: seq,
      topicId,
      at: messageTime(message.timestamp) ?? new Date(received),
      payload: Buffer.from(message.payload, 'base64'),
    });
    this.lastPayload.set(key, message.payload);
  }

  /** A topic's archived payloads in [from, to], in time order. */
  async messages(vehicleId: string, rvm: string, from: Date, to: Date): Promise<ArchivedMessage[]> {
    const seq = await this.keys.vehicleSeq(vehicleId);
    const topicId = (await this.keys.topicIds([rvm], false)).get(rvm);
    if (seq === null || topicId === undefined) return [];
    const [chunks, rows] = await Promise.all([
      this.db
        .select({ data: parallaxChunks.data })
        .from(parallaxChunks)
        .where(
          and(
            eq(parallaxChunks.vehicleSeq, seq),
            eq(parallaxChunks.topicId, topicId),
            gte(parallaxChunks.hour, new Date(Math.floor(from.getTime() / HOUR_MS) * HOUR_MS)),
            lte(parallaxChunks.hour, to),
          ),
        )
        .orderBy(asc(parallaxChunks.hour)),
      this.db
        .select({ at: parallaxArchive.at, payload: parallaxArchive.payload })
        .from(parallaxArchive)
        .where(
          and(
            eq(parallaxArchive.vehicleSeq, seq),
            eq(parallaxArchive.topicId, topicId),
            gte(parallaxArchive.at, from),
            lte(parallaxArchive.at, to),
          ),
        )
        .orderBy(asc(parallaxArchive.at)),
    ]);
    const entries = [
      ...chunks.flatMap((c) => unpackChunk(c.data)),
      ...rows.map((r) => ({ at: r.at.getTime(), payload: r.payload })),
    ].filter((e) => e.at >= from.getTime() && e.at <= to.getTime());
    return entries
      .sort((a, b) => a.at - b.at)
      .map((e) => ({ at: new Date(e.at), payload: e.payload.toString('base64') }));
  }

  /**
   * Packs payloads older than the row window into hourly chunks. Returns
   * how many hours were packed; a full batch means there may be more.
   */
  async rollUp(): Promise<number> {
    const cutoff = new Date(Math.floor((this.now() - ARCHIVE_ROWS_MS) / HOUR_MS) * HOUR_MS);
    const hours = await this.db
      .selectDistinct({
        vehicleSeq: parallaxArchive.vehicleSeq,
        topicId: parallaxArchive.topicId,
        // UTC hours, whatever the session's time zone.
        hour: sql<string>`date_bin('1 hour', ${parallaxArchive.at}, TIMESTAMPTZ '2020-01-01Z')`.as(
          'hour',
        ),
      })
      .from(parallaxArchive)
      .where(lt(parallaxArchive.at, cutoff))
      .limit(ROLL_UP_BATCH);
    for (const { vehicleSeq, topicId, hour } of hours) {
      const start = new Date(hour);
      await this.db.transaction(async (tx) => {
        // Taken out and packed in one transaction, so nothing is lost or kept twice.
        const taken = await tx
          .delete(parallaxArchive)
          .where(
            and(
              eq(parallaxArchive.vehicleSeq, vehicleSeq),
              eq(parallaxArchive.topicId, topicId),
              gte(parallaxArchive.at, start),
              lt(parallaxArchive.at, new Date(start.getTime() + HOUR_MS)),
            ),
          )
          .returning({ at: parallaxArchive.at, payload: parallaxArchive.payload });
        const key = and(
          eq(parallaxChunks.vehicleSeq, vehicleSeq),
          eq(parallaxChunks.topicId, topicId),
          eq(parallaxChunks.hour, start),
        );
        const [existing] = await tx
          .select({ data: parallaxChunks.data })
          .from(parallaxChunks)
          .where(key)
          .for('update');
        const entries = [
          ...(existing ? unpackChunk(existing.data) : []),
          ...taken.map((r) => ({ at: r.at.getTime(), payload: r.payload })),
        ].sort((a, b) => a.at - b.at);
        const values = { count: entries.length, data: packChunk(entries) };
        await tx
          .insert(parallaxChunks)
          .values({ vehicleSeq, topicId, hour: start, ...values })
          .onConflictDoUpdate({
            target: [parallaxChunks.vehicleSeq, parallaxChunks.topicId, parallaxChunks.hour],
            set: values,
          });
      });
    }
    return hours.length;
  }
}

/** A chunk: a format byte, then Brotli of each entry's time (ms), length and payload. */
export function packChunk(entries: readonly Entry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const head = Buffer.alloc(12);
    head.writeBigInt64BE(BigInt(e.at), 0);
    head.writeUInt32BE(e.payload.length, 8);
    parts.push(head, e.payload);
  }
  const packed = brotliCompressSync(Buffer.concat(parts), {
    params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY },
  });
  return Buffer.concat([Buffer.from([CHUNK_FORMAT]), packed]);
}

export function unpackChunk(data: Buffer): Entry[] {
  if (data[0] !== CHUNK_FORMAT) throw new Error(`unknown parallax chunk format ${data[0]}`);
  const raw = brotliDecompressSync(data.subarray(1));
  const entries: Entry[] = [];
  for (let i = 0; i < raw.length;) {
    const at = Number(raw.readBigInt64BE(i));
    const length = raw.readUInt32BE(i + 8);
    entries.push({ at, payload: Buffer.from(raw.subarray(i + 12, i + 12 + length)) });
    i += 12 + length;
  }
  return entries;
}
