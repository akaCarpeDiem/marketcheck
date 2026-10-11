/**
 * Who the visitor is and what they have saved: account, tile and panel
 * layouts, watchlist, holdings, preferences and the daily-call record.
 *
 * Signed out: lists live in this browser (localStorage).
 * Signed in: they live with the account (KV) and follow the user everywhere.
 * Tile and panel layouts are saved for signed-in users only.
 */
import {
  DEFAULT_HERO,
  DEFAULT_INDEXES,
  type HeroAssetDef,
} from '../../functions/_shared/heroCatalog';
import { DEFAULT_PANELS, normalizePanelsLayout, type PanelsLayout } from '../../functions/_shared/panelConfig';
import {
  MAX_HOLDINGS,
  MAX_WATCH,
  emptyUserData,
  normalizeUserData,
  userDataIsEmpty,
  type AssetRef,
  type GameState,
  type Holding,
  type UserData,
} from '../../functions/_shared/userData';
import { ApiError, getJson, sendJson } from '../lib/api';
import { readJson, remove, writeJson } from '../lib/storage';
import { signal } from '../lib/store';

export type { HeroAssetDef, PanelsLayout, UserData, Holding, GameState };

export type AuthUser = { sub: string; email: string; name: string; picture?: string | null };

const GUEST_KEY = 'mc-data-v2';
const CACHE_KEY = 'mc-account-cache-v1';
const OLD_WATCH_KEY = 'mc-watchlist-v1';

export const user = signal<AuthUser | null>(null);
/** False until the first answer about who is signed in. */
export const ready = signal(false);
export const heroDefs = signal<HeroAssetDef[]>(DEFAULT_HERO.map((d) => ({ ...d })));
export const indexDefs = signal<HeroAssetDef[]>(DEFAULT_INDEXES.map((d) => ({ ...d })));
export const panels = signal<PanelsLayout>(normalizePanelsLayout(DEFAULT_PANELS));
export const data = signal<UserData>(emptyUserData());
/** 'saved' | 'saving' | 'error' for the small sync note. */
export const syncState = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');

type Bootstrap = {
  user: AuthUser | null;
  guest: boolean;
  hero: HeroAssetDef[];
  indexes: HeroAssetDef[];
  panels: unknown;
  data: unknown;
};

function loadGuest(): UserData {
  const stored = normalizeUserData(readJson<unknown>(GUEST_KEY, null));
  if (stored.updatedAt || !userDataIsEmpty(stored)) return stored;
  // First run after the redesign: bring over the old local watchlist.
  const old = readJson<Array<{ yahoo?: string; label?: string; name?: string }>>(OLD_WATCH_KEY, []);
  if (Array.isArray(old) && old.length) {
    const migrated = normalizeUserData({
      watchlist: old.map((w) => ({ yahoo: w.yahoo, sym: (w.label || w.yahoo || '').replace(/-USD$/i, ''), name: w.name })),
    });
    migrated.updatedAt = Date.now();
    writeJson(GUEST_KEY, migrated);
    return migrated;
  }
  return stored;
}

function apply(b: Bootstrap): void {
  user.set(b.user);
  heroDefs.set(Array.isArray(b.hero) && b.hero.length === 6 ? b.hero : DEFAULT_HERO.map((d) => ({ ...d })));
  indexDefs.set(
    Array.isArray(b.indexes) && b.indexes.length === DEFAULT_INDEXES.length
      ? b.indexes
      : DEFAULT_INDEXES.map((d) => ({ ...d })),
  );
  panels.set(normalizePanelsLayout(b.panels ?? DEFAULT_PANELS));
}

/** Union of two copies of a user's data, used when two devices changed it at once. */
function merge(mine: UserData, theirs: UserData): UserData {
  const out = normalizeUserData(theirs);
  const keys = new Set(out.watchlist.map((w) => w.key));
  for (const w of mine.watchlist) {
    if (!keys.has(w.key) && out.watchlist.length < MAX_WATCH) out.watchlist.push(w);
  }
  const ids = new Map(out.holdings.map((h, i) => [h.id, i]));
  for (const h of mine.holdings) {
    const at = ids.get(h.id);
    if (at != null) out.holdings[at] = h;
    else if (out.holdings.length < MAX_HOLDINGS) out.holdings.push(h);
  }
  out.prefs = { ...out.prefs, ...mine.prefs };
  if (mine.game.total > out.game.total || mine.game.picks.length > out.game.picks.length) out.game = mine.game;
  return out;
}

/** Ask the server who this is and load their saved state. */
export async function bootstrap(): Promise<void> {
  // Paint from the last known account state straight away, then confirm.
  const cache = readJson<(Bootstrap & { data: UserData }) | null>(CACHE_KEY, null);
  if (cache?.user) {
    apply(cache);
    data.set(normalizeUserData(cache.data));
  } else {
    data.set(loadGuest());
  }

  try {
    const b = await getJson<Bootstrap>('/api/bootstrap', { timeout: 8000 });
    apply(b);
    if (b.user) {
      let server = normalizeUserData(b.data);
      const guest = loadGuest();
      if (userDataIsEmpty(server) && !userDataIsEmpty(guest)) {
        // First sign-in on a browser that already has lists: take them along.
        server = { ...guest, updatedAt: 0 };
        data.set(server);
        queueSave();
      } else {
        data.set(server);
      }
      serverUpdatedAt = normalizeUserData(b.data).updatedAt;
      writeJson(CACHE_KEY, { ...b, data: data.get() });
    } else {
      remove(CACHE_KEY);
      data.set(loadGuest());
    }
  } catch {
    // Offline or the endpoint is down: carry on with what we have.
  } finally {
    ready.set(true);
  }
}

/* ── Saving ────────────────────────────────────────────────────────────── */

let serverUpdatedAt = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving = false;
let dirty = false;

function persistLocal(): void {
  const d = data.get();
  const u = user.get();
  if (!u) {
    writeJson(GUEST_KEY, d);
    return;
  }
  const cache = readJson<Record<string, unknown> | null>(CACHE_KEY, null);
  writeJson(CACHE_KEY, {
    ...(cache ?? {}),
    user: u,
    guest: false,
    hero: heroDefs.get(),
    indexes: indexDefs.get(),
    panels: panels.get(),
    data: d,
  });
}

async function saveNow(): Promise<void> {
  if (!user.get()) return;
  if (saving) {
    dirty = true;
    return;
  }
  saving = true;
  dirty = false;
  syncState.set('saving');
  try {
    let attempt = data.get();
    for (let i = 0; i < 2; i++) {
      try {
        const res = await sendJson<{ data: unknown }>('/api/user/data', 'PUT', { data: attempt, base: serverUpdatedAt });
        const saved = normalizeUserData(res.data);
        serverUpdatedAt = saved.updatedAt;
        // Keep any change made while the request was in flight.
        if (!dirty) data.set({ ...data.get(), updatedAt: saved.updatedAt });
        syncState.set('saved');
        persistLocal();
        break;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && i === 0) {
          const theirs = normalizeUserData((e.body as { data?: unknown } | undefined)?.data);
          serverUpdatedAt = theirs.updatedAt;
          attempt = merge(data.get(), theirs);
          data.set(attempt);
          continue;
        }
        throw e;
      }
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) user.set(null);
    syncState.set('error');
  } finally {
    saving = false;
    if (dirty) queueSave();
  }
}

function queueSave(): void {
  persistLocal();
  if (!user.get()) return;
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), 1200);
}

/** Change the user's data. The change is saved locally at once and to the account shortly after. */
export function change(fn: (draft: UserData) => void): void {
  const draft = normalizeUserData(JSON.parse(JSON.stringify(data.get())));
  fn(draft);
  draft.updatedAt = Math.max(Date.now(), draft.updatedAt);
  data.set(normalizeUserData(draft));
  queueSave();
}

if (typeof window !== 'undefined') {
  // Do not lose a pending change when the tab closes.
  window.addEventListener('pagehide', () => {
    if (!dirty || !user.get()) return;
    clearTimeout(saveTimer);
    try {
      void fetch('/api/user/data', {
        method: 'PUT',
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: data.get(), base: serverUpdatedAt }),
      });
    } catch {
      /* best effort */
    }
  });
}

/* ── Watchlist and holdings ────────────────────────────────────────────── */

export const isWatched = (key: string): boolean => data.get().watchlist.some((w) => w.key === key);

/** Add or remove an asset from the watchlist. Returns true when it is now watched. */
export function toggleWatch(ref: AssetRef): boolean | 'full' {
  let result: boolean | 'full' = false;
  change((d) => {
    const i = d.watchlist.findIndex((w) => w.key === ref.key);
    if (i >= 0) {
      d.watchlist.splice(i, 1);
      result = false;
    } else if (d.watchlist.length >= MAX_WATCH) {
      result = 'full';
    } else {
      d.watchlist.push({ ...ref });
      result = true;
    }
  });
  return result;
}

export function addHolding(ref: AssetRef, qty: number, cost: number | null): boolean {
  if (!(qty > 0) || data.get().holdings.length >= MAX_HOLDINGS) return false;
  change((d) => {
    const existing = d.holdings.find((h) => h.ref.key === ref.key);
    if (existing) {
      // Adding to a position: blend the cost when both are known.
      const total = existing.qty + qty;
      existing.cost =
        existing.cost != null && cost != null ? (existing.cost * existing.qty + cost * qty) / total : (existing.cost ?? cost);
      existing.qty = total;
    } else {
      d.holdings.push({ id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, ref: { ...ref }, qty, cost, at: Date.now() });
    }
  });
  return true;
}

export function updateHolding(id: string, qty: number, cost: number | null): void {
  change((d) => {
    const h = d.holdings.find((x) => x.id === id);
    if (!h) return;
    if (qty > 0) h.qty = qty;
    h.cost = cost;
  });
}

export function removeHolding(id: string): void {
  change((d) => {
    d.holdings = d.holdings.filter((h) => h.id !== id);
  });
}

/* ── Display preferences (this browser only) ───────────────────────────── */

const PREFS_KEY = 'mc-prefs-v1';
let prefs: Record<string, string | number | boolean> | null = null;

function loadPrefs(): Record<string, string | number | boolean> {
  prefs ??= readJson<Record<string, string | number | boolean>>(PREFS_KEY, {}) || {};
  return prefs;
}

/**
 * Remember a display choice (which tab, which timeframe). Kept in this browser
 * only: these change often and are not worth a write to the account.
 */
export function setPref(key: string, value: string | number | boolean): void {
  const p = loadPrefs();
  if (p[key] === value) return;
  p[key] = value;
  writeJson(PREFS_KEY, p);
}

export function pref(key: string, fallback: string): string;
export function pref(key: string, fallback: number): number;
export function pref(key: string, fallback: boolean): boolean;
export function pref(key: string, fallback: string | number | boolean): string | number | boolean {
  const v = loadPrefs()[key];
  return typeof v === typeof fallback ? v! : fallback;
}

/* ── Layouts (signed-in only) ──────────────────────────────────────────── */

export async function saveHero(next: HeroAssetDef[]): Promise<boolean> {
  heroDefs.set(next);
  try {
    const res = await sendJson<{ hero: HeroAssetDef[] }>('/api/layout/hero', 'PUT', { hero: next });
    if (Array.isArray(res.hero)) heroDefs.set(res.hero);
    persistLocal();
    return true;
  } catch {
    return false;
  }
}

export async function saveIndexes(next: HeroAssetDef[]): Promise<boolean> {
  indexDefs.set(next);
  try {
    const res = await sendJson<{ indexes: HeroAssetDef[] }>('/api/layout/indexes', 'PUT', { indexes: next });
    if (Array.isArray(res.indexes)) indexDefs.set(res.indexes);
    persistLocal();
    return true;
  } catch {
    return false;
  }
}

let panelTimer: ReturnType<typeof setTimeout> | undefined;

/** Apply a panel change now and save it after a pause (for quick repeated changes like timeframe flips). */
export function savePanelsSoon(next: PanelsLayout): void {
  panels.set(normalizePanelsLayout(next));
  clearTimeout(panelTimer);
  if (!user.get()) return;
  panelTimer = setTimeout(() => void savePanels(panels.get()), 2500);
}

export async function savePanels(next: PanelsLayout): Promise<boolean> {
  clearTimeout(panelTimer);
  panels.set(normalizePanelsLayout(next));
  try {
    const res = await sendJson<{ panels: unknown }>('/api/layout/panels', 'PUT', { panels: next });
    panels.set(normalizePanelsLayout(res.panels ?? next));
    persistLocal();
    return true;
  } catch {
    return false;
  }
}

/* ── Sign-in and sign-out ──────────────────────────────────────────────── */

export const GOOGLE_LOGIN = '/api/auth/google';
export const MICROSOFT_LOGIN = '/api/auth/microsoft';

export type MagicResult = { ok: true } | { ok: false; error: string };

export async function requestCode(email: string): Promise<MagicResult> {
  try {
    await sendJson('/api/auth/magic/request', 'POST', { email });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'network' };
  }
}

export async function verifyCode(email: string, code: string): Promise<MagicResult> {
  try {
    const res = await sendJson<{ user?: AuthUser }>('/api/auth/magic/verify', 'POST', { email, code });
    if (!res.user) return { ok: false, error: 'invalid' };
    await bootstrap();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'network' };
  }
}

export function magicErrorText(code: string): string {
  switch (code) {
    case 'auth_not_configured':
      return 'Email sign-in is not set up yet.';
    case 'invalid_email':
      return 'Enter a valid email address.';
    case 'test_mode_recipient':
      return 'Email sign-in is in test mode and cannot send to this address yet.';
    case 'send_failed':
      return 'The code could not be sent. Try again.';
    case 'rate_limited':
      return 'Too many requests. Wait a minute and try again.';
    case 'network':
      return 'No connection. Check your internet and try again.';
    case 'invalid':
      return 'That code is not right.';
    case 'expired':
      return 'That code has expired. Request a new one.';
    case 'locked':
      return 'Too many attempts. Request a new code.';
    default:
      return 'Something went wrong. Try again.';
  }
}

export async function signOut(): Promise<void> {
  clearTimeout(saveTimer);
  if (dirty) await saveNow();
  try {
    await fetch('/api/auth/logout?json=1', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } catch {
    /* the cookie may already be gone */
  }
  remove(CACHE_KEY);
  user.set(null);
  apply({ user: null, guest: true, hero: DEFAULT_HERO, indexes: DEFAULT_INDEXES, panels: DEFAULT_PANELS, data: null });
  data.set(loadGuest());
}

/**
 * Delete everything saved for the signed-in account (lists, layouts, daily
 * call record) and sign out. Lists kept in this browser as a guest are untouched.
 */
export async function deleteAccountData(): Promise<boolean> {
  clearTimeout(saveTimer);
  dirty = false;
  // Let a save that is already on its way finish, so it cannot land after the delete.
  for (let i = 0; saving && i < 50; i++) await new Promise((r) => setTimeout(r, 100));
  dirty = false;
  try {
    const res = await fetch('/api/user/data', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return false;
  } catch {
    return false;
  }
  remove(CACHE_KEY);
  user.set(null);
  apply({ user: null, guest: true, hero: DEFAULT_HERO, indexes: DEFAULT_INDEXES, panels: DEFAULT_PANELS, data: null });
  data.set(loadGuest());
  return true;
}
