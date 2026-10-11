/**
 * GET /api/auth/callback — OAuth code exchange + set session cookie.
 */

import {
  type AuthEnv,
  clearOAuthStateCookie,
  getOAuthState,
  publicOrigin,
  sessionMaxAge,
  setSessionCookie,
  signSession,
} from '../../_shared/session';

type Ctx = { request: Request; env: AuthEnv };

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');

  const origin = publicOrigin(request, env);
  const fail = (msg: string) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: `${origin}/?auth_error=${encodeURIComponent(msg)}`,
        'Set-Cookie': clearOAuthStateCookie(),
        'Cache-Control': 'no-store',
      },
    });

  if (err) return fail(err);
  if (!code || !state) return fail('missing_code');
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET) {
    return fail('auth_not_configured');
  }

  const expected = getOAuthState(request);
  if (!expected || expected !== state) return fail('invalid_state');

  const redirectUri = `${origin}/api/auth/callback`;
  let tokens: { access_token?: string; id_token?: string };
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      console.error('token exchange failed', tokenRes.status, t.slice(0, 200));
      return fail('token_exchange');
    }
    tokens = (await tokenRes.json()) as typeof tokens;
  } catch (e) {
    console.error('token exchange error', e);
    return fail('token_exchange');
  }

  if (!tokens.access_token) return fail('no_access_token');

  let profile: {
    sub?: string;
    email?: string;
    name?: string;
    picture?: string;
  };
  try {
    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!infoRes.ok) return fail('userinfo');
    profile = (await infoRes.json()) as typeof profile;
  } catch {
    return fail('userinfo');
  }

  if (!profile.sub || !profile.email) return fail('incomplete_profile');

  const exp = Math.floor(Date.now() / 1000) + sessionMaxAge();
  const token = await signSession(
    {
      sub: profile.sub,
      email: profile.email,
      name: profile.name ?? profile.email,
      picture: profile.picture,
      exp,
    },
    env.SESSION_SECRET,
  );

  const headers = new Headers({
    Location: `${origin}/`,
    'Cache-Control': 'no-store',
  });
  // Multiple Set-Cookie
  headers.append('Set-Cookie', setSessionCookie(token));
  headers.append('Set-Cookie', clearOAuthStateCookie());

  return new Response(null, { status: 302, headers });
}
