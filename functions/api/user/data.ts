/**
 * GET / PUT / DELETE /api/user/data — the signed-in user's watchlist, holdings,
 * preferences and game record (KV `data:<sub>`).
 *
 * DELETE removes everything stored for the account (this record and the saved
 * tile, index and panel layouts) and signs the browser out.
 *
 * PUT body: { data: UserData, base: number }. `base` is the `updatedAt` the
 * browser last saw. If the stored copy is newer (changed on another device),
 * the answer is 409 with the stored copy so the browser can merge and retry.
 */

import { jsonResponse } from '../../_shared/edgeCache';
import { type AuthEnv, clearSessionCookie, getSession } from '../../_shared/session';
import { emptyUserData, normalizeUserData } from '../../_shared/userData';

type Ctx = { request: Request; env: AuthEnv };

export const userDataKey = (sub: string): string => `data:${sub}`;

export async function onRequestGet(context: Ctx): Promise<Response> {
  const session = await getSession(context.request, context.env);
  if (!session) return jsonResponse({ data: emptyUserData(), guest: true });
  let stored: unknown = null;
  try {
    stored = await context.env.LAYOUTS?.get(userDataKey(session.sub), 'json');
  } catch (e) {
    console.error('user data get failed', e);
    return jsonResponse({ error: 'storage_unavailable' }, { status: 503 });
  }
  return jsonResponse({ data: normalizeUserData(stored), guest: false });
}

export async function onRequestPut(context: Ctx): Promise<Response> {
  const session = await getSession(context.request, context.env);
  if (!session) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  if (!context.env.LAYOUTS) return jsonResponse({ error: 'storage_unavailable' }, { status: 503 });

  let text: string;
  try {
    text = await context.request.text();
  } catch {
    return jsonResponse({ error: 'invalid_body' }, { status: 400 });
  }
  if (text.length > 96_000) return jsonResponse({ error: 'too_large' }, { status: 413 });
  let body: { data?: unknown; base?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return jsonResponse({ error: 'invalid_json' }, { status: 400 });
  }

  const key = userDataKey(session.sub);
  let current = emptyUserData();
  try {
    current = normalizeUserData(await context.env.LAYOUTS.get(key, 'json'));
  } catch (e) {
    console.error('user data get failed', e);
    return jsonResponse({ error: 'storage_unavailable' }, { status: 503 });
  }
  const base = typeof body.base === 'number' ? body.base : 0;
  if (current.updatedAt > base) {
    return jsonResponse({ error: 'conflict', data: current }, { status: 409 });
  }

  const next = normalizeUserData(body.data);
  next.updatedAt = Math.max(Date.now(), current.updatedAt + 1);
  try {
    await context.env.LAYOUTS.put(key, JSON.stringify(next));
  } catch (e) {
    console.error('user data put failed', e);
    return jsonResponse({ error: 'save_failed' }, { status: 500 });
  }
  return jsonResponse({ data: next, guest: false });
}

export async function onRequestDelete(context: Ctx): Promise<Response> {
  const session = await getSession(context.request, context.env);
  if (!session) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  const kv = context.env.LAYOUTS;
  if (!kv) return jsonResponse({ error: 'storage_unavailable' }, { status: 503 });
  const keys = [userDataKey(session.sub), `hero:${session.sub}`, `indexes:${session.sub}`, `panels:${session.sub}`];
  const results = await Promise.allSettled(keys.map((k) => kv.delete(k)));
  if (results.some((r) => r.status === 'rejected')) {
    console.error('user data delete failed', results);
    return jsonResponse({ error: 'delete_failed' }, { status: 500 });
  }
  const res = jsonResponse({ ok: true });
  const headers = new Headers(res.headers);
  headers.append('Set-Cookie', clearSessionCookie());
  headers.set('Cache-Control', 'no-store');
  return new Response(res.body, { status: 200, headers });
}
