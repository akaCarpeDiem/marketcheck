/** Short messages at the bottom of the screen. */
import { esc } from '../lib/dom';

let host: HTMLElement | null = null;

export function toast(message: string, kind: 'info' | 'good' | 'bad' = 'info', ms = 3200): void {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.innerHTML = esc(message);
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 260);
  }, ms);
}
