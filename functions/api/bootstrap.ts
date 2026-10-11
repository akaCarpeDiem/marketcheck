/**
 * GET /api/bootstrap — everything the page needs to know about the visitor in
 * one request: who they are, their saved tiles and panels, and their data.
 * Signed-out visitors get the defaults with `guest: true`.
 */

import { jsonResponse } from '../_shared/edgeCache';
import {
  DEFAULT_HERO,
  DEFAULT_INDEXES,
  normalizeHeroLayout,
  normalizeIndexLayout,
} from '../_shared/heroCatalog';
import { DEFAULT_PANELS, normalizePanelsLayout } from '../_shared/panelConfig';
import { type AuthEnv, getSession } from '../_shared/session';
import { emptyUserData, normalizeUserData } from '../_shared/userData';

type Ctx = { request: Request; env: AuthEnv };

export async function onRequestGet(context: Ctx): Promise<Response> {
  const session = await getSession(context.request, context.env).catch(() => null);
  if (!session) {
    return jsonResponse({
      user: null,
      guest: true,
      hero: DEFAULT_HERO,
      indexes: DEFAULT_INDEXES,
      panels: DEFAULT_PANELS,
      data: emptyUserData(),
    });
  }

  const kv = context.env.LAYOUTS;
  const read = async (key: string): Promise<unknown> => {
    if (!kv) return null;
    try {
      return await kv.get(key, 'json');
    } catch (e) {
      console.error('bootstrap get failed', key, e);
      return null;
    }
  };
  const [hero, indexes, panels, data] = await Promise.all([
    read(`hero:${session.sub}`),
    read(`indexes:${session.sub}`),
    read(`panels:${session.sub}`),
    read(`data:${session.sub}`),
  ]);

  return jsonResponse({
    user: {
      sub: session.sub,
      email: session.email,
      name: session.name,
      picture: session.picture ?? null,
    },
    guest: false,
    hero: normalizeHeroLayout(hero),
    indexes: normalizeIndexLayout(indexes),
    panels: normalizePanelsLayout(panels),
    data: normalizeUserData(data),
  });
}
