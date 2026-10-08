/**
 * GET/PUT /api/layout/panels — per-user left/right movers panel configs (KV LAYOUTS).
 */

import {
  DEFAULT_PANELS,
  normalizePanelsLayout,
  type PanelsLayout,
} from '../../_shared/panelConfig';
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
  return `panels:${sub}`;
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const session = await getSession(context.request, context.env);
  if (!session) {
    return json({ panels: DEFAULT_PANELS, guest: true });
  }

  let raw: unknown = null;
  if (context.env.LAYOUTS) {
    try {
      raw = await context.env.LAYOUTS.get(kvKey(session.sub), 'json');
    } catch (e) {
      console.error('LAYOUTS get panels failed', e);
    }
  }

  const panels = normalizePanelsLayout(raw);
  return json({ panels, guest: false });
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

  const obj = (body ?? {}) as { panels?: unknown; left?: unknown; right?: unknown };
  let toNormalize: unknown = obj.panels;
  if (!toNormalize && (obj.left != null || obj.right != null)) {
    toNormalize = { left: obj.left, right: obj.right };
  }

  const panels: PanelsLayout = normalizePanelsLayout(toNormalize);
  try {
    await context.env.LAYOUTS.put(kvKey(session.sub), JSON.stringify(panels));
  } catch (e) {
    console.error('LAYOUTS put panels failed', e);
    return json({ error: 'save_failed' }, 500);
  }

  return json({ panels, guest: false });
}
