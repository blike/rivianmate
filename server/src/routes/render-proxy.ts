import type { FastifyReply } from 'fastify';

/**
 * Rivian's render URLs carry a token, so the server fetches them and keeps
 * each one, keyed by its URL, until discovery stores a new one. Shared by
 * vehicle and order renders: one image is often both.
 */
const renderCache = new Map<string, { type: string; body: Buffer }>();

export async function sendRender(reply: FastifyReply, url: string | null | undefined) {
  if (!url) return reply.code(404).send({ error: 'No render' });
  let render = renderCache.get(url);
  if (!render) {
    const res = await fetch(url);
    if (!res.ok) return reply.code(502).send({ error: 'Render unavailable' });
    render = {
      type: res.headers.get('content-type') ?? 'image/png',
      body: Buffer.from(await res.arrayBuffer()),
    };
    renderCache.set(url, render);
  }
  return reply
    .header('Content-Type', render.type)
    .header('Cache-Control', 'private, max-age=86400')
    .send(render.body);
}
