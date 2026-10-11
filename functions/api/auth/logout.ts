/**
 * GET|POST /api/auth/logout — clear session cookie.
 */

import { type AuthEnv, clearSessionCookie, publicOrigin } from '../../_shared/session';

type Ctx = { request: Request; env: AuthEnv };

async function handle(context: Ctx): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const wantsJson =
    request.headers.get('Accept')?.includes('application/json') ||
    url.searchParams.get('json') === '1' ||
    request.method === 'POST';

  if (wantsJson && request.method === 'POST') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': clearSessionCookie(),
        'Cache-Control': 'no-store',
      },
    });
  }

  const origin = publicOrigin(request, env);
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/`,
      'Set-Cookie': clearSessionCookie(),
      'Cache-Control': 'no-store',
    },
  });
}

export const onRequestGet = handle;
export const onRequestPost = handle;
