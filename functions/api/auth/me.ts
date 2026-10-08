/**
 * GET /api/auth/me — current session user (or null).
 */

import { type AuthEnv, getSession } from '../../_shared/session';

type Ctx = { request: Request; env: AuthEnv };

export async function onRequestGet(context: Ctx): Promise<Response> {
  const session = await getSession(context.request, context.env);
  const body = session
    ? {
        user: {
          sub: session.sub,
          email: session.email,
          name: session.name,
          picture: session.picture ?? null,
        },
      }
    : { user: null };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
