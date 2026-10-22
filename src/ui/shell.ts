/** The live parts of the page frame: market status, account menu, theme, headline ticker. */
import { closedReason, etParts, marketStatus } from '../../functions/_shared/marketCalendar';
import { lastUpdated, overallStatus, crypto, equities, quotes } from '../data/market';
import { loadNews, news, type Headline } from '../data/news';
import { theme, toggleTheme } from '../data/theme';
import { deleteAccountData, ready, signOut, user } from '../data/user';
import { $, esc, frame, html, on, raw, reducedMotion, render } from '../lib/dom';
import { ago, clock, day, etClock, until } from '../lib/format';
import { icon } from '../lib/icons';
import { currentView } from '../router';
import { openAuth } from './auth';
import { openOverlay } from './overlay';
import { openSearch } from './search';
import { toast } from './toast';

/** One line describing where the US market is in its day. */
export function marketLine(now = Date.now()): { state: string; label: string; short: string; detail: string } {
  const s = marketStatus(now);
  if (s.state === 'open') {
    return {
      state: 'open',
      label: 'US market open',
      short: 'Open',
      detail: `closes in ${until(s.closesAt! - now)}${s.early ? ' (1:00 pm ET close)' : ''}`,
    };
  }
  const p = etParts(now);
  const reason = s.reason ?? closedReason(p.y, p.m, p.d);
  const opens = s.nextOpen!;
  const soon = opens - now < 20 * 3600_000;
  const when = soon ? `opens in ${until(opens - now)}` : `opens ${day(opens)} at ${etClock(opens)} ET`;
  if (s.state === 'pre') return { state: 'pre', label: 'Pre-market', short: 'Pre-market', detail: when };
  if (s.state === 'post') return { state: 'post', label: 'After hours', short: 'After hours', detail: when };
  return { state: 'closed', label: reason && reason !== 'Weekend' ? `Closed: ${reason}` : 'US market closed', short: 'Closed', detail: when };
}

function paintMarketChip(): void {
  const el = $('#mkt-chip');
  if (!el) return;
  const m = marketLine();
  render(
    el,
    html`<span class="dot dot-${m.state}"></span><span class="mkt-chip-label">${m.label}</span><span class="mkt-chip-short">${m.short}</span><span class="mkt-chip-detail">${m.detail}</span>`,
  );
  el.title = `${m.label}, ${m.detail}. New York time ${etClock(Date.now())} ET`;
}

function paintTheme(): void {
  const btn = $('[data-action="theme"]');
  if (!btn) return;
  const dark = theme.get() === 'dark';
  render(btn, dark ? icon.sun(16) : icon.moon(16));
  btn.setAttribute('aria-label', dark ? 'Switch to the light theme' : 'Switch to the dark theme');
  btn.title = dark ? 'Light theme' : 'Dark theme';
}

let menuOpen = false;

function paintAccount(): void {
  const el = $('#account');
  if (!el) return;
  const u = user.get();
  if (!u) {
    render(
      el,
      ready.get()
        ? `<button type="button" class="btn btn-primary btn-sm signin-btn" data-action="signin">${icon.user(15)}<span>Sign in</span></button>`
        : `<span class="btn btn-ghost btn-sm is-skeleton" aria-hidden="true">Sign in</span>`,
    );
    return;
  }
  const initial = (u.name || u.email || '?').trim().charAt(0).toUpperCase();
  const pic = u.picture
    ? `<img src="${esc(u.picture)}" alt="" width="28" height="28" referrerpolicy="no-referrer" onerror="this.remove()" />`
    : '';
  render(
    el,
    html`<button type="button" class="account-btn" data-action="account-menu" aria-haspopup="menu" aria-expanded="${menuOpen ? 'true' : 'false'}" aria-label="Account">
        <span class="account-pic"><b>${initial}</b>${raw(pic)}</span>
      </button>
      ${raw(
        menuOpen
          ? html`<div class="menu account-menu" role="menu">
              <div class="menu-head"><strong>${u.name || 'Signed in'}</strong><span>${u.email}</span></div>
              <a class="menu-item" role="menuitem" href="/portfolio/">${raw(icon.wallet(15))} Portfolio and watchlist</a>
              <button type="button" class="menu-item" role="menuitem" data-action="signout">${raw(icon.logout(15))} Sign out</button>
              <div class="menu-sep" role="separator"></div>
              <button type="button" class="menu-item is-danger" role="menuitem" data-action="delete-data">${raw(icon.trash(15))} Delete my saved data</button>
            </div>`
          : '',
      )}`,
  );
}

/** Ask before deleting everything saved for the account. */
function confirmDelete(): void {
  const u = user.get();
  if (!u) return;
  const o = openOverlay({ kind: 'dialog', label: 'Delete saved data', focus: '[data-close]' });
  o.panel.classList.add('confirm');
  const paint = (state: 'ask' | 'busy' | 'failed') => {
    o.panel.innerHTML = html`<button type="button" class="icon-btn overlay-x" data-close aria-label="Close">${raw(icon.close(16))}</button>
      <h2>Delete your saved data?</h2>
      <p class="muted">This removes everything Market Check keeps for <strong>${u.email}</strong>: your watchlist, portfolio, daily call record and the tiles and panels you chose. Then it signs you out.</p>
      <p class="muted">It cannot be undone. You can sign in again later and start fresh.</p>
      ${raw(state === 'failed' ? `<p class="auth-note is-bad" role="alert">That did not go through. Nothing was deleted. Please try again in a moment.</p>` : '')}
      <div class="form-actions">
        <span class="grow"></span>
        <button type="button" class="btn btn-ghost" data-close>Keep my data</button>
        <button type="button" class="btn btn-danger-solid" data-confirm ${state === 'busy' ? 'disabled' : ''}>${state === 'busy' ? 'Deleting…' : 'Delete everything'}</button>
      </div>`;
  };
  paint('ask');
  o.panel.addEventListener('click', async (ev) => {
    if (!(ev.target as Element).closest('[data-confirm]')) return;
    paint('busy');
    if (await deleteAccountData()) {
      o.close();
      toast('Your saved data was deleted and you are signed out.', 'good');
    } else {
      paint('failed');
    }
  });
}

function paintNav(): void {
  const view = currentView.get();
  for (const a of document.querySelectorAll<HTMLElement>('[data-nav]')) {
    const active = a.dataset.nav === view;
    a.classList.toggle('is-active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function paintUpdated(): void {
  const el = $('#foot-updated');
  if (!el) return;
  const at = lastUpdated();
  const status = overallStatus();
  const text = !at
    ? ''
    : status === 'ok'
      ? `Prices updated ${ago(at)} (${clock(at)}).`
      : `Some prices could not be refreshed. Last good update ${ago(at)}.`;
  if (el.textContent !== text) el.textContent = text;
}

/* ── Headline ticker ───────────────────────────────────────────────────── */

const TICKER_CATS = ['markets', 'crypto', 'business'] as const;
let tickerKey = '';

function shorten(title: string, max = 96): string {
  const t = title.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(40, cut.lastIndexOf(' ')))}…`;
}

function paintTicker(): void {
  const host = $('#ticker');
  if (!host) return;
  const map = news.get();
  const lists = TICKER_CATS.map((c) => map.get(c)?.items ?? []);
  // Interleave categories so the strip is a mix, newest first within each.
  const mixed: Headline[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 10; i++) {
    for (const list of lists) {
      const h = list[i];
      if (!h || seen.has(h.link)) continue;
      seen.add(h.link);
      mixed.push(h);
    }
  }
  const items = mixed.slice(0, 18);
  const key = items.map((h) => h.id).join('|');
  if (key === tickerKey) return;
  tickerKey = key;
  if (!items.length) {
    host.innerHTML = '';
    host.classList.remove('has-items');
    return;
  }
  const run = items
    .map(
      (h) =>
        html`<a class="tick" href="${h.link}" target="_blank" rel="noopener noreferrer"><span class="tick-src">${h.source}</span><span class="tick-title">${shorten(h.title)}</span><span class="tick-time">${ago(h.publishedMs)}</span></a>`,
    )
    .join('');
  // Two copies side by side; the animation slides exactly one copy's width, then repeats.
  host.innerHTML = `<span class="ticker-tag">${icon.bolt(12)} Headlines</span><div class="ticker-clip"><div class="ticker-run" style="--n:${items.length}"><div class="ticker-set">${run}</div><div class="ticker-set" aria-hidden="true">${run}</div></div></div>`;
  host.classList.add('has-items');
  if (reducedMotion()) host.classList.add('is-static');
}

/* ── Wiring ────────────────────────────────────────────────────────────── */

export function startShell(): void {
  const body = document.body;

  on(body, 'click', '[data-action="theme"]', () => toggleTheme());
  on(body, 'click', '[data-action="search"]', () => openSearch());
  on(body, 'click', '[data-action="signin"]', () => openAuth());
  on(body, 'click', '[data-action="account-menu"]', (ev) => {
    ev.stopPropagation();
    menuOpen = !menuOpen;
    paintAccount();
  });
  on(body, 'click', '[data-action="signout"]', async () => {
    menuOpen = false;
    await signOut();
    toast('Signed out.');
  });
  on(body, 'click', '[data-action="delete-data"]', () => {
    menuOpen = false;
    paintAccount();
    confirmDelete();
  });
  document.addEventListener('click', (ev) => {
    if (menuOpen && !(ev.target as Element)?.closest?.('.account')) {
      menuOpen = false;
      paintAccount();
    }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && menuOpen) {
      menuOpen = false;
      paintAccount();
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((ev.target as Element)?.tagName ?? '') || (ev.target as HTMLElement)?.isContentEditable;
    if (!typing && (ev.key === '/' || ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k'))) {
      ev.preventDefault();
      openSearch();
    }
  });

  theme.subscribe(paintTheme);
  user.subscribe(paintAccount);
  ready.subscribe(paintAccount);
  currentView.subscribe(() => {
    menuOpen = false;
    paintNav();
    paintAccount();
  });
  const updated = frame(paintUpdated);
  crypto.subscribe(updated);
  equities.subscribe(updated);
  quotes.subscribe(updated);
  news.subscribe(frame(paintTicker));

  paintTheme();
  paintAccount();
  paintNav();
  paintMarketChip();
  setInterval(() => {
    paintMarketChip();
    paintUpdated();
  }, 20_000);

  // The top bar gets a shadow once the page has scrolled.
  const bar = $('#topbar');
  const onScroll = frame(() => bar?.classList.toggle('is-stuck', window.scrollY > 4));
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Headlines for the ticker: all three categories at once, so they travel in the page's first /api/batch request.
  for (const c of TICKER_CATS) void loadNews(c);
  setInterval(() => {
    if (document.hidden) return;
    for (const c of TICKER_CATS) void loadNews(c);
  }, 6 * 60_000);
}
