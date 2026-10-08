/** Resend email sender for magic-link auth. */

import type { AuthEnv } from './session';

export type MagicEmailParams = {
  to: string;
  code: string;
  link: string;
};

export class EmailSendError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_configured' | 'test_mode_recipient' | 'resend_error',
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

export async function sendMagicEmail(
  env: AuthEnv,
  params: MagicEmailParams,
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    throw new EmailSendError('RESEND_API_KEY is not configured', 'not_configured');
  }
  const from =
    env.MAGIC_FROM_EMAIL?.trim() || 'Market Check <noreply@marketcheck.fun>';
  const { to, code, link } = params;

  const text = [
    `Your Market Check sign-in code is: ${code}`,
    '',
    `Or click this link to sign in:`,
    link,
    '',
    `This code expires in 10 minutes. If you did not request it, you can ignore this email.`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;background:#0f1115;color:#e8eaed;padding:24px;">
  <div style="max-width:420px;margin:0 auto;background:#1a1d24;border:1px solid #2a2f3a;border-radius:8px;padding:24px;">
    <h1 style="font-size:18px;margin:0 0 12px;">Market Check sign-in</h1>
    <p style="margin:0 0 16px;color:#9aa0a6;">Your one-time code:</p>
    <p style="font-size:28px;letter-spacing:0.2em;font-weight:700;margin:0 0 20px;">${code}</p>
    <p style="margin:0 0 12px;color:#9aa0a6;">Or use this magic link:</p>
    <p style="margin:0 0 20px;"><a href="${link}" style="color:#3dd6c6;">Sign in to Market Check</a></p>
    <p style="margin:0;font-size:12px;color:#6b7280;">Expires in 10 minutes. If you did not request this, ignore this email.</p>
  </div>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Your Market Check sign-in code',
      text,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('Resend send failed', res.status, body.slice(0, 400));
    const lower = body.toLowerCase();
    if (
      res.status === 403 ||
      lower.includes('only send') ||
      lower.includes('testing emails') ||
      lower.includes('verify a domain') ||
      lower.includes('own email')
    ) {
      throw new EmailSendError(
        'Resend test sender can only email your Resend account address until you verify a domain',
        'test_mode_recipient',
        res.status,
      );
    }
    throw new EmailSendError(`Resend API error ${res.status}`, 'resend_error', res.status);
  }
}
