/**
 * GET /api/auth/google — redirect to Google OAuth authorize.
 */

import {
  type AuthEnv,
  publicOrigin,
  setOAuthStateCookie,
} from '../../_shared/session';

type Ctx = { request: Request; env: AuthEnv };

function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { request, env } = context;
  if (!env.GOOGLE_CLIENT_ID) {
    return new Response(JSON.stringify({ error: 'Auth not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const origin = publicOrigin(request, env);
  const redirectUri = `${origin}/api/auth/callback`;
  const state = randomState();

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Set-Cookie': setOAuthStateCookie(state),
      'Cache-Control': 'no-store',
    },
  });
}
