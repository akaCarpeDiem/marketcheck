/**
 * POST /api/game/nick  { nick: string | null }
 * Choose the name shown on the daily call leaderboard, or leave the board
 * (null). Nothing about a player is shown publicly until they choose a name.
 */
import { jsonResponse } from '../../_shared/edgeCache';
import { cleanNick } from '../../_shared/game';
import { nickTaken, syncBoardLine, type BoardKv } from '../../_shared/gameServer';
import { type AuthEnv, getSession } from '../../_shared/session';
import { normalizeUserData } from '../../_shared/userData';
import { userDataKey } from '../user/data';

type Ctx = { request: Request; env: AuthEnv };

export async function onRequestPost(context: Ctx): Promise<Response> {
  const session = await getSession(context.request, context.env);
  if (!session) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  const store = context.env.LAYOUTS;
  if (!store) return jsonResponse({ error: 'storage_unavailable' }, { status: 503 });
  const kv = store as unknown as BoardKv;

  let body: { nick?: unknown };
  try {
    body = (await context.request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: 'invalid_json' }, { status: 400 });
  }
  const leaving = body.nick == null || body.nick === '';
  const nick = leaving ? null : cleanNick(body.nick);
  if (!leaving && !nick) return jsonResponse({ error: 'invalid_nick' }, { status: 400 });

  try {
    const key = userDataKey(session.sub);
    const data = normalizeUserData(await store.get(key, 'json'));
    if (nick && nick !== data.game.nick && (await nickTaken(kv, session.sub, nick))) {
      return jsonResponse({ error: 'nick_taken' }, { status: 409 });
    }
    if (nick) data.game.nick = nick;
    else delete data.game.nick;
    const now = Date.now();
    await syncBoardLine(kv, session.sub, data.game, now);
    data.updatedAt = Math.max(now, data.updatedAt + 1);
    await store.put(key, JSON.stringify(data));
    return jsonResponse({ data, guest: false });
  } catch (e) {
    console.error('nick save failed', e);
    return jsonResponse({ error: 'temporarily_unavailable' }, { status: 503 });
  }
}
