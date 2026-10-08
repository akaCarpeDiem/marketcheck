/**
 * GET /api/auth/microsoft/callback — MS OAuth code exchange + set session cookie.
 */

import {
  type AuthEnv,
  clearMsOAuthStateCookie,
  getMsOAuthState,
  publicOrigin,
  sessionMaxAge,
  setSessionCookie,
  signSession,
} from '../../../_shared/session';

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
        'Set-Cookie': clearMsOAuthStateCookie(),
        'Cache-Control': 'no-store',
      },
    });

  if (err) return fail(err);
  if (!code || !state) return fail('missing_code');
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET || !env.SESSION_SECRET) {
    return fail('auth_not_configured');
  }

  const expected = getMsOAuthState(request);
  if (!expected || expected !== state) return fail('invalid_state');

  const redirectUri = `${origin}/api/auth/microsoft/callback`;
  let tokens: { access_token?: string };
  try {
    const tokenRes = await fetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.MICROSOFT_CLIENT_ID,
          client_secret: env.MICROSOFT_CLIENT_SECRET,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      },
    );
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      console.error('ms token exchange failed', tokenRes.status, t.slice(0, 200));
      return fail('token_exchange');
    }
    tokens = (await tokenRes.json()) as typeof tokens;
  } catch (e) {
    console.error('ms token exchange error', e);
    return fail('token_exchange');
  }

  if (!tokens.access_token) return fail('no_access_token');

  let profile: {
    id?: string;
    mail?: string | null;
    userPrincipalName?: string;
    displayName?: string;
  };
  try {
    const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!meRes.ok) return fail('userinfo');
    profile = (await meRes.json()) as typeof profile;
  } catch {
    return fail('userinfo');
  }

  if (!profile.id) return fail('incomplete_profile');
  const email = (profile.mail || profile.userPrincipalName || '').trim();
  if (!email) return fail('incomplete_profile');

  const exp = Math.floor(Date.now() / 1000) + sessionMaxAge();
  const token = await signSession(
    {
      sub: `ms:${profile.id}`,
      email,
      name: profile.displayName || email,
      exp,
    },
    env.SESSION_SECRET,
  );

  const headers = new Headers({
    Location: `${origin}/`,
    'Cache-Control': 'no-store',
  });
  headers.append('Set-Cookie', setSessionCookie(token));
  headers.append('Set-Cookie', clearMsOAuthStateCookie());

  return new Response(null, { status: 302, headers });
}
