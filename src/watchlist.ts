/**
 * Local-only watchlist (no accounts). Persisted in localStorage.
 */

export type WatchItem = {
  id: string;
  yahoo: string;
  label: string;
  name?: string;
};

const KEY = 'mc-watchlist-v1';
const MAX = 24;

export function loadWatchlist(): WatchItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is WatchItem =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as WatchItem).yahoo === 'string' &&
          typeof (x as WatchItem).label === 'string' &&
          typeof (x as WatchItem).id === 'string',
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function saveWatchlist(items: WatchItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
  } catch {
    /* quota / private mode */
  }
}

export function isOnWatchlist(items: WatchItem[], yahoo: string): boolean {
  const y = yahoo.toUpperCase();
  return items.some((i) => i.yahoo.toUpperCase() === y);
}

export function toggleWatchlist(items: WatchItem[], item: WatchItem): WatchItem[] {
  const y = item.yahoo.toUpperCase();
  if (items.some((i) => i.yahoo.toUpperCase() === y)) {
    return items.filter((i) => i.yahoo.toUpperCase() !== y);
  }
  return [...items, item].slice(0, MAX);
}

export function clearWatchlist(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

