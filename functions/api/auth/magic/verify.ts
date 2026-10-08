/**
 * POST /api/auth/magic/verify — verify 6-digit code, set mw_session cookie.
 */

import { normalizeEmail, verifyCode } from '../../../_shared/magicAuth';
import {
  type AuthEnv,
  setSessionCookie,
  signSession,
} from '../../../_shared/session';

type Ctx = { request: Request; env: AuthEnv };

function json(data: unknown, status = 200, cookie?: string): Response {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers });
}

export async function onRequestPost(context: Ctx): Promise<Response> {
  const { request, env } = context;

  if (!env.SESSION_SECRET || !env.LAYOUTS) {
    return json({ error: 'auth_not_configured' }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const obj = (body ?? {}) as { email?: unknown; code?: unknown };
  const email = normalizeEmail(String(obj.email ?? ''));
  const code = String(obj.code ?? '');
  if (!email) return json({ error: 'invalid_email' }, 400);

  const result = await verifyCode(env, email, code);
  if (!result.ok) {
    const status =
      result.reason === 'misconfigured'
        ? 503
        : result.reason === 'locked' || result.reason === 'expired'
          ? 429
          : 401;
    return json({ error: result.reason }, status);
  }

  const token = await signSession(result.session, env.SESSION_SECRET);

  return json(
    {
      user: {
        sub: result.session.sub,
        email: result.session.email,
        name: result.session.name,
        picture: null,
      },
    },
    200,
    setSessionCookie(token),
  );
}
