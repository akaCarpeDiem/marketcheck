/**
 * POST /api/batch  {"r": ["/api/cryptos", "/api/markets?symbols=…", …]}
 *
 * Several of the site's read-only GET endpoints in one request, so a page view costs one Function
 * call instead of ten or so (the free plan allows 100,000 a day for the whole account). The answer is
 * newline-delimited JSON, one line per part as soon as that part is ready ({"i":index,"s":status,"b":body}),
 * so a slow part (news) never holds back a fast one (prices). Each part is answered by the endpoint's own
 * handler, so bodies are exactly what the single endpoint returns.
 *
 * Parts whose own answer is `public, max-age=N` are also kept in the Cloudflare edge cache for that long
 * (at most 60 s), so the same prices are shared by every visitor at a location instead of being rebuilt.
 */
import { onRequestGet as bootstrap } from './bootstrap';
import { onRequestGet as cryptos } from './cryptos';
import { onRequestGet as equities } from './equities';
import { onRequestGet as markets } from './markets';
import { onRequestGet as sparklines } from './sparklines';
import { onRequestGet as mood } from './mood';
import { onRequestGet as headlines } from './headlines';
import { onRequestGet as board } from './game/board';
import type { WaitUntil } from '../_shared/edgeCache';

type Handler = (context: { request: Request; env: any; waitUntil?: WaitUntil }) => Promise<Response>;
type Ctx = { request: Request; env: any; waitUntil?: WaitUntil };

const ROUTES: Record<string, Handler> = {
  '/api/bootstrap': bootstrap as Handler,
  '/api/cryptos': cryptos as Handler,
  '/api/equities': equities as Handler,
  '/api/markets': markets as Handler,
  '/api/sparklines': sparklines as Handler,
  '/api/mood': mood as Handler,
  '/api/headlines': headlines as Handler,
  '/api/game/board': board as Handler,
};
export const BATCH_MAX = 16;
const EDGE_MAX_SEC = 60;

function edge(): Cache | null {
  try {
    return (caches as CacheStorage & { default?: Cache }).default ?? null;
  } catch {
    return null;
  }
}

/** Seconds a part may be shared from the edge cache: its own public max-age, capped. 0 = not shared. */
function shareSeconds(res: Response): number {
  const cc = (res.headers.get('Cache-Control') || '').toLowerCase();
  if (!/\bpublic\b/.test(cc) || /no-store|private/.test(cc)) return 0;
  const m = /(?:s-maxage|max-age)=(\d+)/.exec(cc);
  return m ? Math.min(EDGE_MAX_SEC, Number(m[1])) : 0;
}

async function part(ctx: Ctx, path: string): Promise<{ s: number; b: unknown }> {
  const url = new URL(path, ctx.request.url);
  const handler = url.origin === new URL(ctx.request.url).origin ? ROUTES[url.pathname] : undefined;
  if (!handler) return { s: 404, b: { error: 'not_batchable' } };
  const key = new Request(`https://marketcheck.internal/batch${url.pathname}${url.search}`);
  const cache = edge();
  if (url.pathname !== '/api/bootstrap' && cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return { s: hit.status, b: await hit.json() };
    } catch {
      /* cache unreadable: ask the handler */
    }
  }
  const headers = new Headers(ctx.request.headers);
  headers.delete('content-type');
  headers.delete('content-length');
  const res = await handler({ request: new Request(url.toString(), { method: 'GET', headers }), env: ctx.env, waitUntil: ctx.waitUntil });
  const text = await res.text();
  let b: unknown = null;
  try {
    b = text ? JSON.parse(text) : null;
  } catch {
    b = null;
  }
  const keep = res.ok && url.pathname !== '/api/bootstrap' ? shareSeconds(res) : 0;
  if (keep > 0 && cache) {
    const put = cache
      .put(key, new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${keep}` } }))
      .catch(() => undefined);
    if (ctx.waitUntil) ctx.waitUntil(put);
  }
  return { s: res.status, b };
}

export async function onRequestPost(context: Ctx): Promise<Response> {
  let list: unknown;
  try {
    list = ((await context.request.json()) as { r?: unknown })?.r;
  } catch {
    list = null;
  }
  if (!Array.isArray(list) || !list.length || list.length > BATCH_MAX || !list.every((p) => typeof p === 'string' && p.startsWith('/api/'))) {
    return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  let chain = Promise.resolve();
  const send = (line: unknown) => (chain = chain.then(() => writer.write(enc.encode(JSON.stringify(line) + '\n'))));
  const all = Promise.all(
    (list as string[]).map((path, i) =>
      part(context, path)
        .then((r) => send({ i, ...r }))
        .catch((e) => {
          console.error('batch part failed', path, e);
          return send({ i, s: 500, b: { error: 'failed' } });
        }),
    ),
  ).then(() => chain).finally(() => writer.close().catch(() => undefined));
  if (context.waitUntil) context.waitUntil(all);
  return new Response(readable, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export async function onRequest(context: Ctx): Promise<Response> {
  if (context.request.method === 'POST') return onRequestPost(context);
  return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { Allow: 'POST', 'Content-Type': 'application/json' } });
}
