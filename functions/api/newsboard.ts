/**
 * GET /api/newsboard?topic=<id>&board=live|today|yesterday|day&date=YYYY-MM-DD&sweep=1
 *
 * News stories ranked by coverage, Hacker News, Reddit, Google Trends and Wikipedia.
 *   live       rolling last 24 hours
 *   today      stories released today (New York time), locked at the noon check
 *   yesterday  final top ten of the previous day
 *   day        the stored final for `date`, plus the list of days available
 *
 * `sweep=1` (the scheduled workflow) skips the response cache so the day's
 * accumulator and snapshots are brought up to date. The stories come from one
 * subrequest to /api/headlines?pool=1, which runs in its own invocation: a
 * topic's feeds already use most of one invocation's subrequest allowance.
 */

import { cached, jsonResponse, type KvLike, type WaitUntil } from '../_shared/edgeCache';
import { buildBoard, TIMING, type BoardName, type BoardResponse, type FetchLike } from '../_shared/newsBoard';
import { DEFAULT_TOPIC, TOPIC_IDS, topicFrom, topicLabel } from '../_shared/newsTopics';

type Env = { LAYOUTS?: KvLike; REDDIT_CLIENT_ID?: string; REDDIT_CLIENT_SECRET?: string };
type Ctx = { request: Request; env?: Env; waitUntil?: WaitUntil };

const BOARDS: BoardName[] = ['live', 'today', 'yesterday', 'day'];

export type NewsBoardDeps = { fetchFn?: FetchLike; now?: number; ns?: string };

export async function handleNewsBoard(request: Request, env: Env | undefined, waitUntil?: WaitUntil, deps: NewsBoardDeps = {}): Promise<Response> {
  const url = new URL(request.url);
  const asked = (url.searchParams.get('topic') ?? DEFAULT_TOPIC).trim().toLowerCase();
  const topic = topicFrom(asked);
  if (!topic) {
    return jsonResponse({ error: `unknown topic; use ${TOPIC_IDS.join('|')}` }, { status: 400, cacheControl: 'public, max-age=60' });
  }
  const board = (url.searchParams.get('board') ?? 'live').trim().toLowerCase() as BoardName;
  if (!BOARDS.includes(board)) {
    return jsonResponse({ error: `unknown board; use ${BOARDS.join('|')}` }, { status: 400, cacheControl: 'public, max-age=60' });
  }
  const date = url.searchParams.get('date') ?? undefined;
  if (board === 'day' && !(date && /^\d{4}-\d{2}-\d{2}$/.test(date))) {
    return jsonResponse({ error: 'board=day needs date=YYYY-MM-DD' }, { status: 400, cacheControl: 'public, max-age=60' });
  }
  const sweep = url.searchParams.get('sweep') === '1';
  // Looked up when called, so the dev server's stand-in fetch is the one used.
  const fetchFn: FetchLike = deps.fetchFn ?? ((u, init) => fetch(u, init));
  const reddit = env?.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET ? { id: env.REDDIT_CLIENT_ID, secret: env.REDDIT_CLIENT_SECRET } : undefined;
  const run = (): Promise<BoardResponse> =>
    buildBoard({ topic, board, date, sweep, now: deps.now, kv: env?.LAYOUTS ?? null, fetchFn, origin: request.url, waitUntil, ns: deps.ns, reddit });

  try {
    if (sweep || board === 'day') {
      return jsonResponse(await run(), { cacheControl: sweep ? 'no-store' : 'public, max-age=60' });
    }
    const hit = await cached<BoardResponse>(`newsboard:resp:v2:${topic}:${board}${deps.ns ?? ''}`, {
      freshMs: TIMING.responseFreshMs,
      keepSec: 3600,
      retryMs: 60_000,
      waitUntil,
      load: run,
    });
    return jsonResponse(hit.data, { cacheControl: 'public, max-age=60, s-maxage=240' });
  } catch (e) {
    console.error('newsboard request failed', e);
    const now = deps.now ?? Date.now();
    return jsonResponse(
      {
        topic,
        label: topicLabel(topic),
        board,
        date: date ?? new Date(now).toISOString().slice(0, 10),
        status: 'empty',
        generatedAt: new Date(now).toISOString(),
        nextUpdateAt: new Date(now + TIMING.responseFreshMs).toISOString(),
        signals: [],
        stories: [],
      },
      { cacheControl: 'public, max-age=30' },
    );
  }
}

export function onRequestGet(context: Ctx): Promise<Response> {
  return handleNewsBoard(context.request, context.env, context.waitUntil);
}
