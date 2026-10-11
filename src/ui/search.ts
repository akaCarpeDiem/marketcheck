/** The search palette: find any stock, ETF, index, future or coin and open it. */
import type { HeroAssetDef } from '../../functions/_shared/heroCatalog';
import {
  avatar,
  coinForPair,
  KIND_LABEL,
  lookup,
  priceText,
  refFromCoin,
  refFromEquity,
  refFromYahoo,
  type AssetRef,
} from '../data/assets';
import { crypto, equities } from '../data/market';
import { data, isWatched, toggleWatch } from '../data/user';
import { getJson } from '../lib/api';
import { debounce, html, raw } from '../lib/dom';
import { dir, pct } from '../lib/format';
import { icon } from '../lib/icons';
import { openAsset } from './drawer';
import { openOverlay, type Overlay } from './overlay';
import { toast } from './toast';

type Hit = { ref: AssetRef; score: number; size: number };

let overlay: Overlay | null = null;
let query = '';
let hits: AssetRef[] = [];
let remote: AssetRef[] = [];
let active = 0;
let remoteBusy = false;
let remoteToken = 0;
/** What to do with the chosen asset. Defaults to opening its sheet. */
let onPick: ((ref: AssetRef) => void) | null = null;
let title = '';

function score(sym: string, name: string, q: string): number {
  const s = sym.toLowerCase();
  const n = name.toLowerCase();
  if (s === q) return 0;
  if (s.startsWith(q)) return 1;
  if (n === q) return 1.5;
  if (n.startsWith(q)) return 2;
  if (n.split(/\s+/).some((w) => w.startsWith(q))) return 3;
  if (q.length >= 3 && s.includes(q)) return 4;
  return -1;
}

function localSearch(q: string): AssetRef[] {
  const out: Hit[] = [];
  for (const e of equities.get().items) {
    const sc = score(e.symbol, e.name, q);
    if (sc >= 0) out.push({ ref: refFromEquity(e), score: sc, size: e.marketCap ?? 0 });
  }
  for (const c of crypto.get().coins) {
    const sc = score(c.symbol, c.name, q);
    // Wrapped and staked copies sit below the real thing.
    if (sc >= 0) out.push({ ref: refFromCoin(c), score: sc + (c.wrapped ? 0.6 : 0), size: c.marketCap ?? 0 });
  }
  out.sort((a, b) => a.score - b.score || b.size - a.size);
  return out.slice(0, 12).map((h) => h.ref);
}

const POPULAR: AssetRef[] = [
  refFromYahoo('^GSPC', 'S&P 500', 'S&P 500', 'index'),
  refFromYahoo('^IXIC', 'Nasdaq', 'Nasdaq Composite', 'index'),
  refFromYahoo('GC=F', 'Gold', 'Gold futures', 'future'),
  refFromYahoo('CL=F', 'WTI Oil', 'Crude oil futures', 'future'),
  refFromYahoo('^VIX', 'VIX', 'Cboe Volatility Index', 'index'),
  refFromYahoo('^TNX', '10Y yield', 'US 10-year Treasury yield', 'index'),
];

function suggestions(): { label: string; refs: AssetRef[] }[] {
  const groups: { label: string; refs: AssetRef[] }[] = [];
  const watch = data.get().watchlist.slice(0, 6);
  if (watch.length) groups.push({ label: 'Your watchlist', refs: watch });
  const coins = crypto.get().coins.filter((c) => !c.stable && !c.wrapped).slice(0, 4).map(refFromCoin);
  const stocks = [...equities.get().items]
    .filter((e) => e.kind === 'stock' && e.marketCap != null)
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
    .slice(0, 4)
    .map(refFromEquity);
  groups.push({ label: 'Popular', refs: [...stocks, ...coins, ...POPULAR].slice(0, 12) });
  return groups;
}

function row(ref: AssetRef, i: number): string {
  const p = lookup(ref);
  const watched = isWatched(ref.key);
  return html`<li class="hit${i === active ? ' is-active' : ''}" role="option" aria-selected="${i === active ? 'true' : 'false'}" data-hit="${i}">
    ${raw(avatar(ref, p.image, 28))}
    <span class="hit-main"><strong>${ref.sym}</strong><span class="hit-name">${ref.name}</span></span>
    <span class="tag">${KIND_LABEL[ref.kind]}</span>
    <span class="hit-price num">${p.price != null ? priceText(ref, p.price) : ''}</span>
    <span class="hit-chg num ${dir(p.change)}">${p.change != null ? pct(p.change) : ''}</span>
    <button type="button" class="icon-btn icon-btn-sm${watched ? ' is-on' : ''}" data-star="${i}" tabindex="-1" aria-label="${watched ? 'Remove from watchlist' : 'Add to watchlist'}" title="${watched ? 'Remove from watchlist' : 'Add to watchlist'}">${raw(watched ? icon.starFill(15) : icon.star(15))}</button>
  </li>`;
}

function allHits(): AssetRef[] {
  if (!query) return suggestions().flatMap((g) => g.refs);
  const keys = new Set(hits.map((h) => h.key));
  const extra = remote.filter((r) => {
    if (keys.has(r.key)) return false;
    // "BTC-USD" from Yahoo is the same thing as the Bitcoin row already listed.
    const coin = r.kind === 'crypto' && r.yahoo ? coinForPair(r.yahoo) : null;
    if (coin && keys.has(`c:${coin.id}`)) return false;
    return true;
  });
  return [...hits, ...extra].slice(0, 16);
}

function paintList(): void {
  if (!overlay) return;
  const list = overlay.panel.querySelector('.hits');
  if (!list) return;
  const refs = allHits();
  if (active >= refs.length) active = Math.max(0, refs.length - 1);
  let markup = '';
  if (!query) {
    let i = 0;
    for (const g of suggestions()) {
      markup += `<li class="hits-label" role="presentation">${g.label}</li>`;
      for (const ref of g.refs) markup += row(ref, i++);
    }
  } else if (refs.length) {
    markup = refs.map(row).join('');
    if (remoteBusy) markup += `<li class="hits-label" role="presentation">Searching more…</li>`;
  } else {
    markup = `<li class="hits-empty" role="presentation">${remoteBusy ? 'Searching…' : `Nothing found for “${query.replace(/[<>&]/g, '')}”. Try a ticker like AAPL or a name like Bitcoin.`}</li>`;
  }
  list.innerHTML = markup;
  list.querySelector('.hit.is-active')?.scrollIntoView({ block: 'nearest' });
}

const searchRemote = debounce(async (q: string) => {
  const token = (remoteToken += 1);
  remoteBusy = true;
  paintList();
  try {
    const d = await getJson<{ assets?: HeroAssetDef[] }>(`/api/assets?q=${encodeURIComponent(q)}`, { timeout: 10_000 });
    if (token !== remoteToken) return;
    remote = (d.assets ?? []).slice(0, 12).map((a) => refFromYahoo(a.yahoo, /^[A-Za-z]/.test(a.label) ? a.label : undefined, a.name));
  } catch {
    if (token === remoteToken) remote = [];
  } finally {
    if (token === remoteToken) {
      remoteBusy = false;
      paintList();
    }
  }
}, 220);

function setQuery(next: string): void {
  query = next.trim().toLowerCase();
  active = 0;
  remote = [];
  remoteToken += 1;
  remoteBusy = false;
  hits = query ? localSearch(query) : [];
  paintList();
  if (query.length >= 2) searchRemote(query);
}

function choose(i: number): void {
  const ref = allHits()[i];
  if (!ref) return;
  const pick = onPick;
  overlay?.close();
  if (pick) pick(ref);
  else openAsset(ref);
}

/**
 * Open the palette. With `pick`, the chosen asset is handed to it instead of
 * opening the asset sheet (used when choosing a tile or adding a holding).
 */
export function openSearch(opts: { pick?: (ref: AssetRef) => void; title?: string } = {}): void {
  if (overlay?.isOpen()) return;
  onPick = opts.pick ?? null;
  title = opts.title ?? '';
  query = '';
  hits = [];
  remote = [];
  active = 0;
  overlay = openOverlay({
    kind: 'palette',
    label: title || 'Search',
    focus: 'input',
    onClose: () => {
      overlay = null;
      onPick = null;
    },
  });
  const panel = overlay.panel;
  panel.innerHTML = html`${raw(title ? html`<div class="palette-title">${title}</div>` : '')}
    <div class="palette-input">
      ${raw(icon.search(18))}
      <input type="search" placeholder="Search a ticker or name: AAPL, Bitcoin, gold…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Search" aria-controls="search-hits" />
      <button type="button" class="kbd-btn" data-close>Esc</button>
    </div>
    <ul class="hits scroll" id="search-hits" role="listbox" aria-label="Results"></ul>
    <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span>${raw(icon.star(12))} to watch</span></div>`;
  const input = panel.querySelector<HTMLInputElement>('input')!;
  input.addEventListener('input', () => setQuery(input.value));
  input.addEventListener('keydown', (ev) => {
    const n = allHits().length;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      active = n ? (active + 1) % n : 0;
      paintList();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      active = n ? (active - 1 + n) % n : 0;
      paintList();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      choose(active);
    }
  });
  panel.addEventListener('click', (ev) => {
    const t = ev.target as Element;
    const star = t.closest<HTMLElement>('[data-star]');
    if (star) {
      ev.stopPropagation();
      const ref = allHits()[Number(star.dataset.star)];
      if (ref) {
        const res = toggleWatch(ref);
        if (res === 'full') toast('Your watchlist is full.', 'bad');
        paintList();
        input.focus();
      }
      return;
    }
    const hit = t.closest<HTMLElement>('[data-hit]');
    if (hit) choose(Number(hit.dataset.hit));
  });
  panel.addEventListener('pointermove', (ev) => {
    const hit = (ev.target as Element).closest<HTMLElement>('[data-hit]');
    if (!hit) return;
    const i = Number(hit.dataset.hit);
    if (i !== active) {
      active = i;
      for (const li of panel.querySelectorAll('.hit')) li.classList.toggle('is-active', li === hit);
    }
  });
  paintList();
}
