/**
 * GET /api/auth/magic/callback?token= — magic link → set session → redirect /.
 */

import { magicSessionFields, verifyLinkToken } from '../../../_shared/magicAuth';
import {
  type AuthEnv,
  publicOrigin,
  setSessionCookie,
  signSession,
} from '../../../_shared/session';

type Ctx = { request: Request; env: AuthEnv };

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { request, env } = context;
  const origin = publicOrigin(request, env);
  const fail = (msg: string) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: `${origin}/?auth_error=${encodeURIComponent(msg)}`,
        'Cache-Control': 'no-store',
      },
    });

  if (!env.SESSION_SECRET || !env.LAYOUTS) {
    return fail('auth_not_configured');
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  if (!token) return fail('missing_token');

  const email = await verifyLinkToken(env, token);
  if (!email) return fail('invalid_token');

  const session = magicSessionFields(email);
  const signed = await signSession(session, env.SESSION_SECRET);
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/`,
      'Set-Cookie': setSessionCookie(signed),
      'Cache-Control': 'no-store',
    },
  });
}
