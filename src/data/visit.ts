/**
 * "Since your last visit": remembers the prices seen at the end of each visit
 * (in this browser) so the next visit can show what changed.
 */
import { readJson, writeJson } from '../lib/storage';
import { signal } from '../lib/store';
import { lookup, refFromHero, type AssetRef } from './assets';
import { crypto, equities } from './market';
import { data, heroDefs } from './user';

type Snapshot = { at: number; prices: Record<string, number> };

const KEY = 'mc-visit-v1';
const SESSION_KEY = 'mc-visit-base';
/** A gap this long counts as a new visit. */
const MIN_GAP_MS = 3 * 3_600_000;
const MAX_AGE_MS = 45 * 86_400_000;

/** The previous visit's snapshot, when there is one worth comparing with. */
export const lastVisit = signal<Snapshot | null>(null);

function tracked(): AssetRef[] {
  const seen = new Set<string>();
  const out: AssetRef[] = [];
  const add = (r: AssetRef) => {
    if (seen.has(r.key)) return;
    seen.add(r.key);
    out.push(r);
  };
  for (const d of heroDefs.get()) add(refFromHero(d));
  for (const w of data.get().watchlist) add(w);
  for (const h of data.get().holdings) add(h.ref);
  return out;
}

function save(): void {
  if (crypto.get().status === 'loading' && equities.get().status === 'loading') return;
  const prices: Record<string, number> = {};
  for (const ref of tracked()) {
    const p = lookup(ref);
    if (p.price != null && !p.stale) prices[ref.key] = p.price;
  }
  if (Object.keys(prices).length) writeJson(KEY, { at: Date.now(), prices });
}

export function startVisitTracking(): void {
  let base: Snapshot | null = null;
  try {
    base = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null') as Snapshot | null;
  } catch {
    base = null;
  }
  if (!base) {
    const prev = readJson<Snapshot | null>(KEY, null);
    const age = prev ? Date.now() - prev.at : 0;
    if (prev && prev.prices && age >= MIN_GAP_MS && age <= MAX_AGE_MS) {
      base = prev;
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(prev));
      } catch {
        /* ignore */
      }
    }
  }
  if (base && Date.now() - base.at <= MAX_AGE_MS) lastVisit.set(base);

  setInterval(() => {
    if (!document.hidden) save();
  }, 60_000);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
  });
}

export function dismissLastVisit(): void {
  lastVisit.set(null);
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ at: 0, prices: {} }));
  } catch {
    /* ignore */
  }
}

export type VisitChange = { ref: AssetRef; change: number; from: number; to: number };

/** Percent change of each tracked asset since the last visit, biggest first. */
export function changesSince(snap: Snapshot): VisitChange[] {
  const out: VisitChange[] = [];
  for (const ref of tracked()) {
    const from = snap.prices[ref.key];
    const to = lookup(ref).price;
    if (!from || to == null) continue;
    out.push({ ref, change: (to / from - 1) * 100, from, to });
  }
  return out.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}
