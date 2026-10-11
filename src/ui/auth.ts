/** The sign-in dialog: Google, Microsoft, or a six-digit code by email. */
import { GOOGLE_LOGIN, MICROSOFT_LOGIN, magicErrorText, requestCode, verifyCode } from '../data/user';
import { html, raw } from '../lib/dom';
import { GOOGLE_MARK, MICROSOFT_MARK, icon } from '../lib/icons';
import { logoMark } from '../lib/icons';
import { openOverlay, type Overlay } from './overlay';
import { toast } from './toast';

let current: Overlay | null = null;

type Phase = 'idle' | 'sending' | 'sent' | 'verifying';
const ui = { email: '', code: '', phase: 'idle' as Phase, note: '', bad: false };

function body(): string {
  const sent = ui.phase === 'sent' || ui.phase === 'verifying';
  return html`<button type="button" class="icon-btn overlay-x" data-close aria-label="Close">${raw(icon.close(16))}</button>
    <div class="auth-head">
      ${raw(logoMark(40))}
      <h2>Make this dashboard yours</h2>
      <p>Sign in to choose your own tiles and panels, and to keep your watchlist and portfolio on every device.</p>
    </div>
    <div class="auth-providers">
      <a class="btn btn-wide btn-outline" href="${GOOGLE_LOGIN}">${raw(GOOGLE_MARK)}<span>Continue with Google</span></a>
      <a class="btn btn-wide btn-outline" href="${MICROSOFT_LOGIN}">${raw(MICROSOFT_MARK)}<span>Continue with Microsoft</span></a>
    </div>
    <div class="auth-or"><span>or use your email</span></div>
    <form class="auth-form" data-auth-form novalidate>
      <label class="field">
        <span class="field-label">Email address</span>
        <input class="input" type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" value="${ui.email}" ${sent ? 'readonly' : ''} required />
      </label>
      ${raw(
        sent
          ? html`<label class="field">
              <span class="field-label">Six-digit code from the email</span>
              <input class="input input-code num" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" value="${ui.code}" />
            </label>`
          : '',
      )}
      ${raw(ui.note ? html`<p class="auth-note${ui.bad ? ' is-bad' : ''}" role="status">${ui.note}</p>` : '')}
      <button type="submit" class="btn btn-wide btn-primary" ${ui.phase === 'sending' || ui.phase === 'verifying' ? 'disabled' : ''}>
        ${ui.phase === 'sending' ? 'Sending…' : ui.phase === 'verifying' ? 'Checking…' : sent ? 'Sign in' : 'Email me a code'}
      </button>
      ${raw(sent ? `<button type="button" class="btn btn-wide btn-ghost" data-auth-restart>Use a different email</button>` : '')}
    </form>
    <p class="auth-foot">You can use everything except custom tiles without an account. See the <a href="/privacy/">privacy page</a> for what is stored.</p>`;
}

function paint(focus?: string): void {
  if (!current) return;
  current.panel.innerHTML = body();
  if (focus) current.panel.querySelector<HTMLElement>(focus)?.focus();
}

async function submit(form: HTMLFormElement): Promise<void> {
  const fd = new FormData(form);
  ui.email = String(fd.get('email') ?? '').trim();
  ui.code = String(fd.get('code') ?? '').replace(/\D/g, '');
  if (ui.phase === 'sent') {
    if (ui.code.length !== 6) {
      ui.note = 'Enter the six-digit code from the email.';
      ui.bad = true;
      paint('input[name="code"]');
      return;
    }
    ui.phase = 'verifying';
    ui.note = '';
    paint();
    const res = await verifyCode(ui.email, ui.code);
    if (res.ok) {
      ui.phase = 'idle';
      ui.code = '';
      ui.note = '';
      current?.close();
      toast('You are signed in.', 'good');
      return;
    }
    ui.phase = 'sent';
    ui.note = magicErrorText(res.error);
    ui.bad = true;
    paint('input[name="code"]');
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ui.email)) {
    ui.note = 'Enter a valid email address.';
    ui.bad = true;
    paint('input[name="email"]');
    return;
  }
  ui.phase = 'sending';
  ui.note = '';
  paint();
  const res = await requestCode(ui.email);
  if (res.ok) {
    ui.phase = 'sent';
    ui.note = `We sent a code to ${ui.email}. It can take a minute to arrive.`;
    ui.bad = false;
    paint('input[name="code"]');
  } else {
    ui.phase = 'idle';
    ui.note = magicErrorText(res.error);
    ui.bad = true;
    paint('input[name="email"]');
  }
}

export function openAuth(note?: string): void {
  if (current?.isOpen()) return;
  if (note) {
    ui.note = note;
    ui.bad = true;
  } else if (ui.phase === 'idle') {
    ui.note = '';
  }
  current = openOverlay({ kind: 'dialog', label: 'Sign in', onClose: () => (current = null) });
  current.panel.classList.add('auth');
  current.panel.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void submit(ev.target as HTMLFormElement);
  });
  current.panel.addEventListener('click', (ev) => {
    if ((ev.target as Element).closest('[data-auth-restart]')) {
      ui.phase = 'idle';
      ui.code = '';
      ui.note = '';
      paint('input[name="email"]');
    }
  });
  current.panel.addEventListener('input', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.name === 'email') ui.email = t.value;
    if (t.name === 'code') {
      t.value = t.value.replace(/\D/g, '').slice(0, 6);
      ui.code = t.value;
    }
  });
  paint();
}

/** After an OAuth or email-link redirect that failed, say so. */
export function reportAuthError(): void {
  const url = new URL(location.href);
  const err = url.searchParams.get('auth_error');
  if (!err) return;
  url.searchParams.delete('auth_error');
  history.replaceState(history.state, '', url.pathname + url.search);
  const text =
    err === 'auth_not_configured'
      ? 'Sign-in is not set up yet.'
      : err === 'invalid_token' || err === 'missing_token'
        ? 'That sign-in link has expired. Request a new code.'
        : 'Sign-in did not finish. Please try again.';
  openAuth(text);
}
