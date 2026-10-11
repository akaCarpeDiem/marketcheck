/**
 * GET /api/auth/microsoft — redirect to Microsoft OAuth authorize.
 */

import {
  type AuthEnv,
  publicOrigin,
  setMsOAuthStateCookie,
} from '../../_shared/session';

type Ctx = { request: Request; env: AuthEnv };

function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { request, env } = context;
  if (!env.MICROSOFT_CLIENT_ID) {
    return new Response(JSON.stringify({ error: 'Auth not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const origin = publicOrigin(request, env);
  const redirectUri = `${origin}/api/auth/microsoft/callback`;
  const state = randomState();

  const params = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'openid profile email offline_access User.Read',
    state,
    prompt: 'select_account',
  });

  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Set-Cookie': setMsOAuthStateCookie(state),
      'Cache-Control': 'no-store',
    },
  });
}
