import type { HeroAssetDef } from './yahoo';
import { AUTH_FETCH_MS, SEARCH_FETCH_MS, fetchSignal } from './fetchTimeout';
import type { PanelsLayout } from '../../functions/_shared/panelConfig';
import { DEFAULT_PANELS, normalizePanelsLayout } from '../../functions/_shared/panelConfig';

export type { PanelConfig, PanelsLayout, PanelMode, PanelSort, PanelSize, PanelAssetRef } from '../../functions/_shared/panelConfig';
export { DEFAULT_PANELS, panelShowsTfBar, METALS_PRESET } from '../../functions/_shared/panelConfig';

export type AuthUser = {
  sub: string;
  email: string;
  name: string;
  picture?: string | null;
};

export async function fetchMe(signal?: AbortSignal): Promise<AuthUser | null> {
  try {
    const res = await fetch('/api/auth/me', { signal: fetchSignal(AUTH_FETCH_MS, signal), credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = (await res.json()) as { user: AuthUser | null };
    return data.user ?? null;
  } catch {
    return null;
  }
}

export function loginUrl(): string {
  return '/api/auth/google';
}

export function microsoftLoginUrl(): string {
  return '/api/auth/microsoft';
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout?json=1', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } catch {
    /* ignore */
  }
}

export type MagicRequestResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

export async function requestMagicLink(email: string): Promise<MagicRequestResult> {
  try {
    const res = await fetch('/api/auth/magic/request', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      let error = 'send_failed';
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error) error = data.error;
      } catch {
        /* ignore */
      }
      return { ok: false, error, status: res.status };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'network', status: 0 };
  }
}

export type MagicVerifyResult =
  | { ok: true; user: AuthUser }
  | { ok: false; error: string; status: number };

export async function verifyMagicCode(
  email: string,
  code: string,
): Promise<MagicVerifyResult> {
  try {
    const res = await fetch('/api/auth/magic/verify', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    if (!res.ok) {
      let error = 'invalid';
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error) error = data.error;
      } catch {
        /* ignore */
      }
      return { ok: false, error, status: res.status };
    }
    const data = (await res.json()) as { user?: AuthUser };
    if (!data.user) return { ok: false, error: 'invalid', status: res.status };
    return { ok: true, user: data.user };
  } catch {
    return { ok: false, error: 'network', status: 0 };
  }
}

export async function fetchHeroLayout(
  signal?: AbortSignal,
): Promise<{ hero: HeroAssetDef[]; guest: boolean } | null> {
  try {
    const res = await fetch('/api/layout/hero', { signal, credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = (await res.json()) as { hero?: HeroAssetDef[]; guest?: boolean };
    if (!Array.isArray(data.hero) || data.hero.length !== 6) return null;
    return { hero: data.hero, guest: Boolean(data.guest) };
  } catch {
    return null;
  }
}

export async function saveHeroLayout(hero: HeroAssetDef[]): Promise<HeroAssetDef[] | null> {
  try {
    const res = await fetch('/api/layout/hero', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ hero }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { hero?: HeroAssetDef[] };
    return Array.isArray(data.hero) ? data.hero : null;
  } catch {
    return null;
  }
}

export async function fetchAssets(
  q = '',
  signal?: AbortSignal,
): Promise<HeroAssetDef[]> {
  try {
    const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
    const res = await fetch(`/api/assets${qs}`, { signal: fetchSignal(SEARCH_FETCH_MS, signal), credentials: 'same-origin' });
    if (!res.ok) return [];
    const data = (await res.json()) as { assets?: HeroAssetDef[] };
    return Array.isArray(data.assets) ? data.assets : [];
  } catch {
    return [];
  }
}

export async function fetchIndexLayout(
  signal?: AbortSignal,
): Promise<{ indexes: HeroAssetDef[]; guest: boolean } | null> {
  try {
    const res = await fetch('/api/layout/indexes', { signal, credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = (await res.json()) as { indexes?: HeroAssetDef[]; guest?: boolean };
    if (!Array.isArray(data.indexes) || data.indexes.length !== 10) return null;
    return { indexes: data.indexes, guest: Boolean(data.guest) };
  } catch {
    return null;
  }
}

export async function saveIndexLayout(indexes: HeroAssetDef[]): Promise<HeroAssetDef[] | null> {
  try {
    const res = await fetch('/api/layout/indexes', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ indexes }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { indexes?: HeroAssetDef[] };
    return Array.isArray(data.indexes) ? data.indexes : null;
  } catch {
    return null;
  }
}


export async function fetchPanelsLayout(
  signal?: AbortSignal,
): Promise<{ panels: PanelsLayout; guest: boolean } | null> {
  try {
    const res = await fetch('/api/layout/panels', { signal, credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = (await res.json()) as { panels?: unknown; guest?: boolean };
    const panels = normalizePanelsLayout(data.panels ?? DEFAULT_PANELS);
    return { panels, guest: Boolean(data.guest) };
  } catch {
    return null;
  }
}

export async function savePanelsLayout(panels: PanelsLayout): Promise<PanelsLayout | null> {
  try {
    const res = await fetch('/api/layout/panels', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ panels }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { panels?: unknown };
    return normalizePanelsLayout(data.panels ?? panels);
  } catch {
    return null;
  }
}
