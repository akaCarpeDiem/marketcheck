/** The daily call leaderboard, loaded when someone looks at it. */
import type { BoardRow } from '../../functions/_shared/game';
import { getJson } from '../lib/api';
import { signal } from '../lib/store';

export type { BoardRow };

export type BoardState = {
  status: 'idle' | 'loading' | 'ok' | 'error';
  /** YYYY-MM the monthly table is for. */
  month: string;
  monthRows: BoardRow[];
  allRows: BoardRow[];
  players: number;
  at: number;
};

export const board = signal<BoardState>({ status: 'idle', month: '', monthRows: [], allRows: [], players: 0, at: 0 });

type Payload = { ok?: boolean; month?: string; monthRows?: BoardRow[]; allRows?: BoardRow[]; players?: number; at?: number };

let busy: Promise<void> | null = null;

/** Load the board unless a copy from the last two minutes is in hand. */
export function loadBoard(force = false): Promise<void> {
  const have = board.get();
  if (!force && have.status === 'ok' && Date.now() - have.at < 120_000) return Promise.resolve();
  busy ??= (async () => {
    if (have.status !== 'ok') board.set({ ...have, status: 'loading' });
    try {
      const d = await getJson<Payload>(`/api/game/board${force ? `?t=${Date.now()}` : ''}`, { timeout: 15_000 });
      if (!d.ok) throw new Error('unavailable');
      board.set({
        status: 'ok',
        month: d.month ?? '',
        monthRows: d.monthRows ?? [],
        allRows: d.allRows ?? [],
        players: d.players ?? 0,
        at: Date.now(),
      });
    } catch {
      board.set({ ...board.get(), status: board.get().at ? 'ok' : 'error' });
    }
  })().finally(() => {
    busy = null;
  });
  return busy;
}

/** Where a name stands in a table (1 = first), or null. */
export function rankOf(rows: BoardRow[], nick: string | undefined): number | null {
  if (!nick) return null;
  const i = rows.findIndex((r) => r.name === nick);
  return i >= 0 ? i + 1 : null;
}
