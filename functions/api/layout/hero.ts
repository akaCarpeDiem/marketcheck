/**
 * GET/PUT /api/layout/hero — per-user hero tile layout (KV LAYOUTS).
 */

import {
  DEFAULT_HERO,
  findHeroAsset,
  normalizeHeroLayout,
  type HeroAssetDef,
} from '../../_shared/heroCatalog';
import { type AuthEnv, getSession } from '../../_shared/session';

type Env = AuthEnv;

type Ctx = { request: Request; env: Env };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function kvKey(sub: string): string {
  return `hero:${sub}`;
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const session = await getSession(context.request, context.env);
  if (!session) {
    return json({ hero: DEFAULT_HERO, guest: true });
  }

  let raw: unknown = null;
  if (context.env.LAYOUTS) {
    try {
      const stored = await context.env.LAYOUTS.get(kvKey(session.sub), 'json');
      raw = stored;
    } catch (e) {
      console.error('LAYOUTS get failed', e);
    }
  }

  const hero = normalizeHeroLayout(raw);
  return json({ hero, guest: false });
}

export async function onRequestPut(context: Ctx): Promise<Response> {
  const session = await getSession(context.request, context.env);
  if (!session) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!context.env.LAYOUTS) {
    return json({ error: 'storage_unavailable' }, 503);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const obj = (body ?? {}) as { hero?: unknown; slots?: unknown };
  let toNormalize: unknown = obj.hero;

  if (!toNormalize && Array.isArray(obj.slots)) {
    const slots = obj.slots as unknown[];
    if (slots.length !== 6) {
      return json({ error: 'slots_must_be_length_6' }, 400);
    }
    const defs: HeroAssetDef[] = [];
    for (const s of slots) {
      if (typeof s !== 'string') {
        return json({ error: 'invalid_slot' }, 400);
      }
      const found = findHeroAsset(s);
      if (!found) {
        return json({ error: `unknown_asset:${s}` }, 400);
      }
      defs.push(found);
    }
    toNormalize = defs;
  }

  const hero = normalizeHeroLayout(toNormalize);
  try {
    await context.env.LAYOUTS.put(kvKey(session.sub), JSON.stringify(hero));
  } catch (e) {
    console.error('LAYOUTS put failed', e);
    return json({ error: 'save_failed' }, 500);
  }

  return json({ hero, guest: false });
}
