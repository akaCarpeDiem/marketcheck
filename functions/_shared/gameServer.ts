/** Server side of the daily call: the index's closes, and reading and writing the leaderboard. */
import { cacheGet, cachePut, type WaitUntil } from './edgeCache';
import {
  GAME_SYMBOL,
  boardEntry,
  closesByDay,
  finishEntry,
  monthOf,
  nickKey,
  rankBoard,
  type BoardEntry,
  type BoardRow,
} from './game';
import type { GameState } from './userData';
import { fetchChart, type Series } from './yahoo';

/** The parts of a KV namespace the board uses (metadata and listing). */
export type BoardKv = {
  put(key: string, value: string, options?: { metadata?: unknown; expirationTtl?: number }): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list(options: { prefix: string; limit?: number; cursor?: string }): Promise<{
    keys: { name: string; metadata?: unknown }[];
    list_complete: boolean;
    cursor?: string;
  }>;
};

const BOARD_PREFIX = 'board:';
export const boardKey = (sub: string): string => `${BOARD_PREFIX}${sub}`;

/**
 * The S&P 500's daily closes for the last three months, by New York date.
 * Uses the same cache entry as /api/chart, so the browser and the server
 * always settle a call against the same number. Null if Yahoo cannot be read
 * and nothing is cached.
 */
export async function indexCloses(waitUntil?: WaitUntil): Promise<Map<string, number> | null> {
  const key = `chart:${GAME_SYMBOL}:3mo:1d`;
  const hit = await cacheGet<Series>(key);
  let series: Series | null = hit && Date.now() - hit.at < 10 * 60_000 ? hit.data : null;
  if (!series) {
    series = await fetchChart(GAME_SYMBOL, '3mo', '1d').catch(() => null);
    if (series && series.c.length > 1) cachePut(key, series, { keepSec: 86_400, waitUntil });
    else series = hit?.data ?? null;
  }
  if (!series || series.c.length < 2) return null;
  return closesByDay(series.t, series.c);
}

const isEntry = (v: unknown): v is BoardEntry => {
  const e = v as BoardEntry | null;
  return !!e && typeof e.n === 'string' && typeof e.w === 'number' && typeof e.t === 'number';
};

/** Every player's stored line, with the account it belongs to. */
export async function readBoard(kv: BoardKv): Promise<{ sub: string; entry: BoardEntry }[]> {
  const out: { sub: string; entry: BoardEntry }[] = [];
  let cursor: string | undefined;
  // 1,000 names a page; three pages is far beyond what the free plan's storage would hold anyway.
  for (let page = 0; page < 3; page++) {
    const res = await kv.list({ prefix: BOARD_PREFIX, limit: 1000, cursor });
    for (const k of res.keys) if (isEntry(k.metadata)) out.push({ sub: k.name.slice(BOARD_PREFIX.length), entry: k.metadata });
    if (res.list_complete || !res.cursor) break;
    cursor = res.cursor;
  }
  return out;
}

export type Board = {
  /** Month the monthly table is for, YYYY-MM. */
  month: string;
  monthRows: BoardRow[];
  allRows: BoardRow[];
  players: number;
  at: number;
};

export function buildBoard(lines: { entry: BoardEntry }[], closes: Map<string, number> | null, now: number): Board {
  const done = lines.map((l) => finishEntry(l.entry, closes, now));
  return {
    month: monthOf(now),
    monthRows: rankBoard(done.map((d) => ({ row: d.month, first: d.first }))),
    allRows: rankBoard(done.map((d) => ({ row: d.all, first: d.first }))),
    players: done.filter((d) => d.all.total > 0 || d.month.total > 0).length,
    at: now,
  };
}

/**
 * Bring a player's board line in step with their game. Writes only when the
 * line would change (about once a trading day per player) and never throws:
 * a failed write is tried again with the next save.
 */
export async function syncBoardLine(kv: BoardKv, sub: string, game: GameState, now: number): Promise<void> {
  const entry = game.nick ? boardEntry(game.nick, game.picks, now) : null;
  const sig = entry ? JSON.stringify(entry) : '';
  if (sig === (game.bs ?? '')) return;
  try {
    if (entry) await kv.put(boardKey(sub), '1', { metadata: entry });
    else await kv.delete(boardKey(sub));
    if (sig) game.bs = sig;
    else delete game.bs;
  } catch (e) {
    console.error('board write failed', e);
  }
}

/** True if another player already shows under a name that would look the same. */
export async function nickTaken(kv: BoardKv, sub: string, nick: string): Promise<boolean> {
  const want = nickKey(nick);
  const lines = await readBoard(kv);
  return lines.some((l) => l.sub !== sub && nickKey(l.entry.n) === want);
}
