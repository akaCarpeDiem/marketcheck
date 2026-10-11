/**
 * POST /api/auth/magic/request — send 6-digit code + magic link via Resend.
 */

import { EmailSendError, sendMagicEmail } from '../../../_shared/email';
import { createChallenge, normalizeEmail } from '../../../_shared/magicAuth';
import { type AuthEnv, publicOrigin } from '../../../_shared/session';

type Ctx = { request: Request; env: AuthEnv };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequestPost(context: Ctx): Promise<Response> {
  const { request, env } = context;

  if (!env.RESEND_API_KEY || !env.SESSION_SECRET || !env.LAYOUTS) {
    return json({ error: 'auth_not_configured' }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const rawEmail =
    typeof body === 'object' && body && 'email' in body
      ? String((body as { email: unknown }).email ?? '')
      : '';
  const email = normalizeEmail(rawEmail);
  if (!email) {
    return json({ error: 'invalid_email' }, 400);
  }

  const challenge = await createChallenge(env, email);
  if (!challenge.ok) {
    if (challenge.reason === 'misconfigured') {
      return json({ error: 'auth_not_configured' }, 503);
    }
    // Rate limited — generic success (don't leak)
    return json({ ok: true });
  }

  const origin = publicOrigin(request, env);
  const link = `${origin}/api/auth/magic/callback?token=${encodeURIComponent(challenge.linkToken)}`;

  try {
    await sendMagicEmail(env, { to: email, code: challenge.code, link });
  } catch (e) {
    console.error('magic email send failed', e);
    if (e instanceof EmailSendError && e.code === 'test_mode_recipient') {
      return json({ error: 'test_mode_recipient' }, 502);
    }
    return json({ error: 'send_failed' }, 502);
  }

  return json({ ok: true });
}
