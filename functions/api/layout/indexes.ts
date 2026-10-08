/**
 * GET/PUT /api/layout/indexes — per-user Indexes · ETFs row layout (KV LAYOUTS).
 */

import {
  DEFAULT_INDEXES,
  findHeroAsset,
  normalizeIndexLayout,
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
  return `indexes:${sub}`;
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const session = await getSession(context.request, context.env);
  if (!session) {
    return json({ indexes: DEFAULT_INDEXES, guest: true });
  }

  let raw: unknown = null;
  if (context.env.LAYOUTS) {
    try {
      const stored = await context.env.LAYOUTS.get(kvKey(session.sub), 'json');
      raw = stored;
    } catch (e) {
      console.error('LAYOUTS get indexes failed', e);
    }
  }

  const indexes = normalizeIndexLayout(raw);
  return json({ indexes, guest: false });
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

  const obj = (body ?? {}) as { indexes?: unknown; slots?: unknown };
  let toNormalize: unknown = obj.indexes;

  if (!toNormalize && Array.isArray(obj.slots)) {
    const slots = obj.slots as unknown[];
    if (slots.length !== DEFAULT_INDEXES.length) {
      return json({ error: `slots_must_be_length_${DEFAULT_INDEXES.length}` }, 400);
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

  const indexes = normalizeIndexLayout(toNormalize);
  try {
    await context.env.LAYOUTS.put(kvKey(session.sub), JSON.stringify(indexes));
  } catch (e) {
    console.error('LAYOUTS put indexes failed', e);
    return json({ error: 'save_failed' }, 500);
  }

  return json({ indexes, guest: false });
}
