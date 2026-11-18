/** Pure helpers for the news leaderboard: movement, formatting and the read tracker. No DOM, no network. */

export type Move = { kind: 'up' | 'down' | 'same' | 'new' | 'none'; by: number };

/**
 * How a story moved. The server's previous rank wins; on a live board the rank
 * the reader saw at the last refresh fills in when the server has none.
 */
export function movement(rank: number, prevRank: number | null | undefined, live: boolean, seenRank?: number | null): Move {
  const from = typeof prevRank === 'number' ? prevRank : live && typeof seenRank === 'number' ? seenRank : null;
  if (from == null) return live ? { kind: 'new', by: 0 } : { kind: 'none', by: 0 };
  const by = from - rank;
  return by > 0 ? { kind: 'up', by } : by < 0 ? { kind: 'down', by: -by } : { kind: 'same', by: 0 };
}

/** A 🔥 story: very hot, or it climbed three places or more. */
export const isHot = (heat: number, m: Move): boolean => heat >= 90 || (m.kind === 'up' && m.by >= 3);

const trim = (n: number): string => String(Number(n.toFixed(1)));

/** 5300 -> "5.3k", 1200000 -> "1.2M" */
export function count(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1e6) return `${trim(n / 1e6)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${trim(n / 1e3)}k`;
  return String(Math.round(n));
}

/** Search traffic is a lower bound: 1000000 -> "1M+", 200 -> "200+" */
export const traffic = (n: number): string => `${count(n)}+`;

const GEOS: Record<string, string> = { US: 'United States', GB: 'UK', UK: 'UK', IN: 'India', CA: 'Canada', AU: 'Australia' };
export const geoName = (code: string): string => GEOS[code.toUpperCase()] ?? code;

/** "Updated just now" / "Updated 3 min ago" / "Updated 2 h ago" */
export function updatedText(ms: number, now = Date.now()): string {
  const m = Math.max(0, Math.floor((now - ms) / 60_000));
  if (m < 1) return 'Updated just now';
  if (m < 60) return `Updated ${m} min ago`;
  const h = Math.floor(m / 60);
  return `Updated ${h} h ago`;
}

/** "r/technology" from "technology" or "r/technology" */
export const subName = (sub: string): string => `r/${sub.replace(/^\/?r\//i, '')}`;

/* ── Read tracker: story ids per New York date ───────────────────────────── */

export type ReadLog = Record<string, string[]>;

const dayNum = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** Keep today and the two days before it; drop anything else, malformed entries included. */
export function pruneRead(log: unknown, today: string, keepDays = 3): ReadLog {
  const out: ReadLog = {};
  if (!log || typeof log !== 'object') return out;
  const t = dayNum(today);
  for (const [date, ids] of Object.entries(log as Record<string, unknown>)) {
    const age = t - dayNum(date);
    if (!Number.isFinite(age) || age < 0 || age >= keepDays || !Array.isArray(ids)) continue;
    out[date] = ids.filter((x): x is string => typeof x === 'string').slice(-500);
  }
  return out;
}

/** A copy of the log with the story marked (or unmarked) on `date`. */
export function setRead(log: ReadLog, date: string, id: string, read: boolean): ReadLog {
  const out: ReadLog = { ...log };
  if (read) {
    const ids = out[date] ?? [];
    if (!ids.includes(id)) out[date] = [...ids, id];
  } else {
    for (const d of Object.keys(out)) out[d] = out[d]!.filter((x) => x !== id);
  }
  return out;
}

/** Every id read on any kept day. */
export const readSet = (log: ReadLog): Set<string> => new Set(Object.values(log).flat());

export function progress(ids: string[], read: Set<string>): { read: number; total: number; done: boolean } {
  const n = ids.filter((id) => read.has(id)).length;
  return { read: n, total: ids.length, done: ids.length > 0 && n === ids.length };
}

/** Does the board have a top-three story the reader has not read? */
export const hasUnreadTop = (ids: string[], read: Set<string>, top = 3): boolean => ids.slice(0, top).some((id) => !read.has(id));
