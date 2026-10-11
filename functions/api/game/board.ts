/**
 * GET /api/game/board — the daily call leaderboard: this month and all time.
 * Built from one KV list call and shared for five minutes, so reading it is
 * cheap however many people look.
 */
import { cached, jsonResponse, type WaitUntil } from '../../_shared/edgeCache';
import { buildBoard, indexCloses, readBoard, type Board, type BoardKv } from '../../_shared/gameServer';

type Ctx = { request: Request; env?: { LAYOUTS?: unknown }; waitUntil?: WaitUntil };

export async function onRequestGet(context: Ctx): Promise<Response> {
  const kv = context.env?.LAYOUTS as BoardKv | undefined;
  if (!kv) return jsonResponse({ ok: false, error: 'storage_unavailable' }, { status: 503 });
  try {
    const hit = await cached<Board>('game-board:v1', {
      freshMs: 5 * 60_000,
      keepSec: 6 * 3600,
      retryMs: 60_000,
      waitUntil: context.waitUntil,
      load: async () => {
        const [lines, closes] = await Promise.all([readBoard(kv), indexCloses(context.waitUntil)]);
        return buildBoard(lines, closes, Date.now());
      },
    });
    return jsonResponse({ ok: true, ...hit.data, stale: hit.stale }, { cacheControl: 'public, max-age=60' });
  } catch (e) {
    console.error('board read failed', e);
    return jsonResponse({ ok: false, error: 'temporarily_unavailable' }, { status: 503 });
  }
}
