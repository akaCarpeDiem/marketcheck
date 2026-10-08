/** Simple in-memory TTL cache (Workers isolate + Vite middleware). */
export function makeCache<T>(ttlMs: number) {
  const map = new Map<string, { at: number; data: T }>();
  return {
    /** Fresh hit within TTL. Expired entries are kept for getStale(). */
    get(key: string): T | null {
      const hit = map.get(key);
      if (!hit) return null;
      if (Date.now() - hit.at > ttlMs) return null;
      return hit.data;
    },
    /** Last-good value even after TTL (for 429 / upstream failure fallback). */
    getStale(key: string): T | null {
      const hit = map.get(key);
      return hit ? hit.data : null;
    },
    ageMs(key: string): number | null {
      const hit = map.get(key);
      if (!hit) return null;
      return Date.now() - hit.at;
    },
    set(key: string, data: T): void {
      map.set(key, { at: Date.now(), data });
    },
  };
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
