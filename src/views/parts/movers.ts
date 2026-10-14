/** The two movers panels (customisable) and the bubble map card on the overview. */
import { gainersAndLosers, topByVolume, type CryptoTf } from '../../../functions/_shared/cryptoUniverse';
import { equityTf } from '../../../functions/_shared/equityUniverse';
import {
  DEFAULT_PANEL_LEFT,
  DEFAULT_PANEL_RIGHT,
  METALS_PRESET,
  type PanelChain,
  type PanelConfig,
  type PanelMode,
  type PanelSort,
} from '../../../functions/_shared/panelConfig';
import { avatar, heroFromRef, lookup, priceText, refFromCoin, refFromEquity, refFromHero, stockLogo, type AssetRef } from '../../data/assets';
import { bnb, crypto, equities, eth, quotes, wantQuotes } from '../../data/market';
import {
  MOVER_CATS,
  biggestMoves,
  coinState,
  effectiveTf,
  isCoinCat,
  loadCat,
  loadSolana,
  moverTip,
  solana,
  solanaPool,
  tfLabel,
  tfOptions,
  type Mover,
  type MoverCat,
} from '../../data/movers';
import { data, panels, pref, savePanels, savePanelsSoon, setPref, user } from '../../data/user';
import { esc, frame, html, on, raw, render } from '../../lib/dom';
import { compact, dir, pct } from '../../lib/format';
import { icon } from '../../lib/icons';
import type { Scope } from '../../lib/store';
import { openAuth } from '../../ui/auth';
import { createBubbleMap, type Bubble, type BubbleMap } from '../../ui/bubbles';
import { openAsset } from '../../ui/drawer';
import { flash } from '../../ui/flash';
import { openOverlay } from '../../ui/overlay';
import { openSearch } from '../../ui/search';
import { toast } from '../../ui/toast';
import { statusNote } from './tables';

type Side = 'left' | 'right';

type Row = {
  ref: AssetRef;
  /** Where a click goes when there is no asset sheet (Solana tokens). */
  href?: string;
  image: string | null;
  price: number | null;
  change: number | null;
  marketCap: number | null;
  volume: number | null;
};

const MODE_LABEL: Record<PanelMode, string> = {
  movers_up: 'Crypto: biggest gainers',
  movers_down: 'Crypto: biggest losers',
  stocks_up: 'Stocks: biggest gainers',
  stocks_down: 'Stocks: biggest losers',
  watchlist: 'My watchlist',
  curated: 'A list I choose',
  filter_crypto: 'Crypto, sorted my way',
  filter_stocks: 'Stocks, sorted my way',
  filter_metals: 'Metals',
};

const STOCK_PANEL_TFS: [string, string][] = [['24h', '1D'], ['7d', '1W'], ['30d', '1M'], ['1y', '1Y']];

/** The chain tabs on the crypto gainers and losers panels, and where each one's coins come from. */
const CHAIN_TABS: { id: PanelChain; label: string; title: string; cat: MoverCat; name: string }[] = [
  { id: 'all', label: 'All Crypto', title: 'Every coin in the top 250, on any chain', cat: 'cryptos', name: '' },
  { id: 'eth', label: 'ETH', title: 'Ethereum tokens', cat: 'ethereum', name: 'Ethereum ' },
  { id: 'sol', label: 'SOL', title: 'Solana tokens', cat: 'solana', name: 'Solana ' },
  { id: 'bnb', label: 'BNB', title: 'BNB Chain (Binance) tokens', cat: 'bnb', name: 'BNB Chain ' },
];
const chainTab = (chain: PanelChain) => CHAIN_TABS.find((c) => c.id === chain) ?? CHAIN_TABS[0]!;

const isCryptoMovers = (m: PanelMode): boolean => m === 'movers_up' || m === 'movers_down';
/** A gainers panel switched to "Top volume": the most-traded coins instead of the biggest rises. */
const byVolume = (cfg: PanelConfig): boolean => cfg.mode === 'movers_up' && cfg.sort.startsWith('volume');

const hasTfBar = (m: PanelMode): boolean => m === 'movers_up' || m === 'movers_down' || m === 'stocks_up' || m === 'stocks_down';
const hasSort = (m: PanelMode): boolean => m === 'filter_crypto' || m === 'filter_stocks' || m === 'curated' || m === 'watchlist' || m === 'filter_metals';

function sortRows(rows: Row[], sort: PanelSort): Row[] {
  const by = (get: (r: Row) => number | null) => [...rows].sort((a, b) => (get(b) ?? -Infinity) - (get(a) ?? -Infinity));
  if (sort === 'mcap') return by((r) => r.marketCap);
  if (sort === 'volume_24h' || sort === 'volume_7d' || sort === 'volume_30d') return by((r) => r.volume ?? r.marketCap);
  return by((r) => (r.change == null ? null : Math.abs(r.change)));
}

function fromRefs(refs: AssetRef[]): Row[] {
  return refs.map((ref) => {
    const p = lookup(ref);
    return { ref, image: p.image, price: p.price, change: p.change, marketCap: p.marketCap, volume: p.coin?.volume ?? null };
  });
}

const fromMover = (m: Mover): Row => ({
  ref: m.ref ?? { key: m.key, sym: m.sym, name: m.name, kind: 'crypto' },
  href: m.ref ? undefined : m.href,
  image: m.image,
  price: m.price,
  change: m.change,
  marketCap: m.marketCap,
  volume: m.volume,
});

type PanelRows = { rows: Row[]; changeLabel: string; source: string; empty: string; loading?: boolean };

/** Crypto gainers, losers or top volume, for every chain or one. */
function cryptoMoverRows(cfg: PanelConfig): PanelRows {
  const n = cfg.size;
  const tab = chainTab(cfg.chain);
  const up = cfg.mode === 'movers_up';
  const vol = byVolume(cfg);
  const label = tfLabel(tab.cat, cfg.tf);
  const coins = tab.id === 'all' ? 'coin' : `${tab.name}token`;
  const empty = vol ? `No ${coins} trading data right now.` : up ? `No liquid ${coins} is up over ${label}.` : `No liquid ${coins} is down over ${label}.`;
  if (tab.cat === 'solana') {
    const pool = solanaPool(cfg.tf, vol ? 'volume' : up ? 'up' : 'down');
    return { rows: pool.items.slice(0, n).map(fromMover), changeLabel: vol ? `Vol ${label}` : label, source: 'Jupiter', empty, loading: pool.status === 'loading' };
  }
  const s = coinState(tab.cat);
  const tf = effectiveTf(tab.cat, cfg.tf) as CryptoTf;
  // CoinGecko publishes trading volume for the last 24 hours only, whatever the timeframe.
  const list = vol ? topByVolume(s.coins, n) : gainersAndLosers(s.coins, tf, n)[up ? 'gainers' : 'losers'];
  return {
    rows: list.map((c) => ({ ref: refFromCoin(c), image: c.image, price: c.price, change: c.ch[tf] ?? null, marketCap: c.marketCap, volume: c.volume })),
    changeLabel: vol ? 'Vol 24h' : label,
    source: 'CoinGecko',
    empty,
    loading: s.status === 'loading',
  };
}

/** The rows a panel shows right now, and the label for its change column. */
function panelRows(cfg: PanelConfig): PanelRows {
  const n = cfg.size;
  switch (cfg.mode) {
    case 'movers_up':
    case 'movers_down':
      return cryptoMoverRows(cfg);
    case 'stocks_up':
    case 'stocks_down': {
      const tf = equityTf(cfg.tf);
      const up = cfg.mode === 'stocks_up';
      const list = equities
        .get()
        .items.filter((e) => e.kind === 'stock' && e.ok && e.ch[tf] != null && (up ? e.ch[tf]! > 0 : e.ch[tf]! < 0))
        .sort((a, b) => (up ? b.ch[tf]! - a.ch[tf]! : a.ch[tf]! - b.ch[tf]!))
        .slice(0, n);
      const label = STOCK_PANEL_TFS.find(([id]) => id === tf)?.[1] ?? '1D';
      return {
        rows: list.map((e) => ({ ref: refFromEquity(e), image: stockLogo(e.symbol), price: e.price, change: e.ch[tf], marketCap: e.marketCap, volume: null })),
        changeLabel: label,
        source: 'Yahoo Finance',
        empty: up ? 'No stock in the list is up.' : 'No stock in the list is down.',
      };
    }
    case 'filter_crypto': {
      const pool = crypto.get().coins.filter((c) => !c.stable && !c.wrapped && c.price != null);
      const rows = pool.map((c) => ({ ref: refFromCoin(c), image: c.image, price: c.price, change: c.ch['24h'], marketCap: c.marketCap, volume: c.volume }));
      return { rows: sortRows(rows, cfg.sort).slice(0, n), changeLabel: '24h', source: 'CoinGecko', empty: 'Crypto prices are not available right now.' };
    }
    case 'filter_stocks': {
      const rows = equities
        .get()
        .items.filter((e) => e.kind === 'stock' && e.ok)
        .map((e) => ({ ref: refFromEquity(e), image: stockLogo(e.symbol), price: e.price, change: e.ch['24h'], marketCap: e.marketCap, volume: null }));
      return { rows: sortRows(rows, cfg.sort).slice(0, n), changeLabel: '1D', source: 'Yahoo Finance', empty: 'Stock prices are not available right now.' };
    }
    case 'watchlist': {
      const rows = fromRefs(data.get().watchlist);
      return { rows: sortRows(rows, cfg.sort).slice(0, n), changeLabel: 'Day', source: 'CoinGecko · Yahoo Finance', empty: 'Your watchlist is empty. Star something from search to see it here.' };
    }
    case 'filter_metals':
    case 'curated': {
      const defs = cfg.mode === 'filter_metals' ? METALS_PRESET : cfg.assets;
      const rows = fromRefs(defs.map((d) => refFromHero(d)));
      return { rows: sortRows(rows, cfg.sort).slice(0, n), changeLabel: 'Day', source: 'Yahoo Finance · CoinGecko', empty: 'This list is empty. Edit the panel to add assets.' };
    }
  }
}

/** Yahoo symbols a panel needs quotes for. */
function panelSymbols(cfg: PanelConfig): string[] {
  const refs =
    cfg.mode === 'curated'
      ? cfg.assets.map((d) => refFromHero(d))
      : cfg.mode === 'filter_metals'
        ? METALS_PRESET.map((d) => refFromHero(d))
        : cfg.mode === 'watchlist'
          ? data.get().watchlist
          : [];
  return refs.filter((r) => !r.cg && r.yahoo).map((r) => r.yahoo!);
}

function metric(row: Row, cfg: PanelConfig): string {
  if (byVolume(cfg)) return `<span class="num">${compact(row.volume)}</span>`;
  if (hasSort(cfg.mode) && cfg.sort === 'mcap') return `<span class="num">${compact(row.marketCap)}</span>`;
  if (hasSort(cfg.mode) && cfg.sort.startsWith('volume') && row.volume != null) return `<span class="num">${compact(row.volume)}</span>`;
  return `<span class="pill ${dir(row.change)} num">${pct(row.change)}</span>`;
}

function panelHtml(side: Side, cfg: PanelConfig): string {
  const { rows, changeLabel, source, empty, loading: rowsLoading } = panelRows(cfg);
  const loading =
    !rows.length &&
    (rowsLoading ?? (cfg.mode === 'filter_crypto' ? crypto.get().status === 'loading' : equities.get().status === 'loading' && cfg.mode !== 'watchlist'));
  const cat = chainTab(cfg.chain).cat;
  // CoinGecko volume is 24h only, so a top-volume list from it has no timeframe to pick.
  const showTf = hasTfBar(cfg.mode) && !(byVolume(cfg) && cat !== 'solana');
  const tfBar = showTf
    ? `<div class="seg" role="group" aria-label="Timeframe">${(cfg.mode.startsWith('stocks') ? STOCK_PANEL_TFS : tfOptions(cat).map((o) => [o.id, o.label] as [string, string]))
        .map(([id, label]) => {
          const on = (cfg.mode.startsWith('stocks') ? equityTf(cfg.tf) : effectiveTf(cat, cfg.tf)) === id;
          return `<button type="button" class="seg-btn${on ? ' is-on' : ''}" data-panel-tf="${side}:${id}" aria-pressed="${on ? 'true' : 'false'}">${label}</button>`;
        })
        .join('')}</div>`
    : '';
  const editBtn = `<button type="button" class="icon-btn icon-btn-sm" data-panel-edit="${side}" aria-label="Change what this panel shows" title="Change what this panel shows">${icon.edit(14)}</button>`;
  // Crypto movers: the edit button rides on the chain row, so the title row has room for the gainers / top volume switch.
  const chainBar = isCryptoMovers(cfg.mode)
    ? `<div class="panel-tools"><div class="seg seg-scroll" role="group" aria-label="Chain">${CHAIN_TABS.map(
        (c) => `<button type="button" class="seg-btn${c.id === cfg.chain ? ' is-on' : ''}" data-panel-chain="${side}:${c.id}" aria-pressed="${c.id === cfg.chain ? 'true' : 'false'}" title="${c.title}">${c.label}</button>`,
      ).join('')}</div><span class="grow"></span>${editBtn}</div>`
    : '';
  // The timeframe row sits right above the columns. When there is no timeframe to pick it keeps
  // its height, so a gainers and a losers panel side by side always line up.
  const tfRow = hasTfBar(cfg.mode) ? `<div class="panel-tools">${tfBar || '<span class="panel-note">Ranked by 24h trading volume</span>'}</div>` : '';
  const rankBar =
    cfg.mode === 'movers_up'
      ? `<div class="seg seg-sm" role="group" aria-label="Rank by">${([['change', '%'], ['volume_24h', 'Volume']] as const)
          .map(([id, label]) => {
            const on = (id === 'change') !== byVolume(cfg);
            return `<button type="button" class="seg-btn${on ? ' is-on' : ''}" data-panel-rank="${side}:${id}" aria-pressed="${on ? 'true' : 'false'}">${label}</button>`;
          })
          .join('')}</div>`
      : '';
  const metricLabel = hasSort(cfg.mode) && cfg.sort === 'mcap' ? 'Market cap' : hasSort(cfg.mode) && cfg.sort.startsWith('volume') ? 'Volume' : changeLabel;
  const body = rows.length
    ? rows
        .map(
          (r, i) => html`<li class="mover" data-panel-open="${side}:${i}" tabindex="0" role="button">
            <span class="mover-rank num">${i + 1}</span>
            ${raw(avatar(r.ref, r.image, 26))}
            <span class="mover-id"><strong>${r.ref.sym}</strong><span>${r.ref.name}</span></span>
            <span class="mover-price num" data-flash="${side}${r.ref.key}" data-v="${r.price ?? ''}">${priceText(r.ref, r.price)}</span>
            ${raw(metric(r, cfg))}
          </li>`,
        )
        .join('')
    : loading
      ? Array.from({ length: cfg.size > 10 ? 10 : cfg.size }, () => `<li class="mover is-loading"><span class="sk">0</span><span class="sk" style="border-radius:50%">00</span><span class="sk">Asset name</span><span class="sk">$00.00</span><span class="sk">+0.0%</span></li>`).join('')
      : `<li class="mover-empty">${esc(empty)}</li>`;
  const tone = cfg.mode.endsWith('_up') ? 'up' : cfg.mode.endsWith('_down') ? 'down' : 'brand';
  return html`<div class="card-head">
      <h2 class="card-title"><span class="panel-dot ${byVolume(cfg) ? 'brand' : tone}"></span><span class="panel-name" title="${cfg.title}">${cfg.title}</span></h2>
      <div class="card-tools">
        ${raw(rankBar)}
        ${raw(chainBar ? '' : editBtn)}
      </div>
      ${raw(chainBar)}
      ${raw(tfRow)}
    </div>
    <div class="mover-cols"><span>Asset</span><span>Price</span><span>${metricLabel}</span></div>
    <ol class="movers${cfg.size > 10 ? ' is-long scroll' : ''}">${raw(body)}</ol>
    <div class="card-foot"><span>${source}</span></div>`;
}

/* ── Panel editor ──────────────────────────────────────────────────────── */

function openPanelEditor(side: Side): void {
  let draft: PanelConfig = JSON.parse(JSON.stringify(panels.get()[side])) as PanelConfig;
  const o = openOverlay({ kind: 'dialog', label: 'Change what this panel shows', focus: 'select[name="mode"]' });
  o.panel.classList.add('panel-editor');

  const paint = (error = '') => {
    const modes = Object.entries(MODE_LABEL) as [PanelMode, string][];
    const sorts: [PanelSort, string][] = [['change', 'Biggest move today'], ['mcap', 'Market cap'], ['volume_24h', '24h volume (crypto)']];
    o.panel.innerHTML = html`<button type="button" class="icon-btn overlay-x" data-close aria-label="Close">${raw(icon.close(16))}</button>
      <h2>Change this panel</h2>
      <form novalidate>
        <label class="field"><span class="field-label">Show</span>
          <select class="input" name="mode">${raw(modes.map(([id, label]) => `<option value="${id}"${draft.mode === id ? ' selected' : ''}>${esc(label)}</option>`).join(''))}</select>
        </label>
        <label class="field"><span class="field-label">Title</span>
          <input class="input" name="title" maxlength="48" value="${draft.title}" />
        </label>
        <div class="field-row">
          <label class="field"><span class="field-label">Rows</span>
            <select class="input" name="size"><option value="10"${draft.size === 10 ? ' selected' : ''}>10</option><option value="25"${draft.size === 25 ? ' selected' : ''}>25</option></select>
          </label>
          ${raw(
            hasSort(draft.mode)
              ? `<label class="field"><span class="field-label">Order by</span><select class="input" name="sort">${sorts
                  .map(([id, label]) => `<option value="${id}"${(draft.sort.startsWith('volume') ? 'volume_24h' : draft.sort) === id ? ' selected' : ''}>${esc(label)}</option>`)
                  .join('')}</select></label>`
              : '',
          )}
        </div>
        ${raw(
          draft.mode === 'curated'
            ? html`<div class="field"><span class="field-label">Assets in this list (${draft.assets.length} of 40)</span>
                <div class="chips">${raw(draft.assets.map((a, i) => `<button type="button" class="chip" data-remove-asset="${i}" title="Remove">${esc(a.label)} ${icon.close(11)}</button>`).join(''))}
                <button type="button" class="chip chip-add" data-add-asset>${raw(icon.plus(12))} Add</button></div></div>`
            : '',
        )}
        ${raw(error ? html`<p class="auth-note is-bad" role="alert">${error}</p>` : '')}
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-reset>Reset</button>
          <span class="grow"></span>
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>`;
  };
  paint();

  const read = () => {
    const form = o.panel.querySelector('form');
    if (!form) return;
    const fd = new FormData(form);
    const mode = String(fd.get('mode')) as PanelMode;
    const prevMode = draft.mode;
    draft.mode = mode;
    draft.size = Number(fd.get('size')) === 25 ? 25 : 10;
    if (fd.get('sort')) draft.sort = String(fd.get('sort')) as PanelSort;
    const typed = String(fd.get('title') ?? '').trim();
    // Keep the title in step with the mode unless the user wrote their own.
    const wasAuto = !typed || Object.values(AUTO_TITLE).includes(typed) || typed === DEFAULT_PANEL_LEFT.title || typed === DEFAULT_PANEL_RIGHT.title || /^Top \d+ (Pumps|Dumps)$/.test(typed);
    draft.title = wasAuto || mode !== prevMode ? (wasAuto ? AUTO_TITLE[mode] : typed) : typed;
    if (mode.startsWith('stocks') && !STOCK_PANEL_TFS.some(([id]) => id === draft.tf)) draft.tf = '24h';
    // A sort picked for a filter list must not turn a new gainers panel into a top-volume one.
    if (mode !== prevMode && isCryptoMovers(mode)) draft.sort = 'change';
  };

  o.panel.addEventListener('change', (ev) => {
    const name = (ev.target as HTMLSelectElement).name;
    read();
    if (name === 'mode') paint();
  });
  o.panel.addEventListener('click', (ev) => {
    const t = ev.target as Element;
    const rm = t.closest<HTMLElement>('[data-remove-asset]');
    if (rm) {
      read();
      draft.assets.splice(Number(rm.dataset.removeAsset), 1);
      paint();
      return;
    }
    if (t.closest('[data-add-asset]')) {
      read();
      if (draft.assets.length >= 40) {
        paint('A list can hold 40 assets.');
        return;
      }
      openSearch({
        title: 'Add an asset to this list',
        pick: (ref) => {
          const def = heroFromRef(ref);
          if (!draft.assets.some((a) => a.yahoo.toUpperCase() === def.yahoo.toUpperCase())) draft.assets.push(def);
          paint();
        },
      });
      return;
    }
    if (t.closest('[data-reset]')) {
      draft = JSON.parse(JSON.stringify(side === 'left' ? DEFAULT_PANEL_LEFT : DEFAULT_PANEL_RIGHT)) as PanelConfig;
      paint();
    }
  });
  o.panel.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    read();
    if (draft.mode === 'curated' && !draft.assets.length) {
      paint('Add at least one asset to the list.');
      return;
    }
    const next = { ...panels.get(), [side]: draft };
    o.close();
    const ok = await savePanels(next);
    toast(ok ? 'Panel saved.' : 'That could not be saved. Try again.', ok ? 'good' : 'bad');
  });
}

const AUTO_TITLE: Record<PanelMode, string> = {
  movers_up: 'Crypto gainers',
  movers_down: 'Crypto losers',
  stocks_up: 'Stock gainers',
  stocks_down: 'Stock losers',
  watchlist: 'My watchlist',
  curated: 'My list',
  filter_crypto: 'Crypto',
  filter_stocks: 'Stocks',
  filter_metals: 'Metals',
};

/* ── Bubble card ───────────────────────────────────────────────────────── */

export type SizeBy = 'move' | 'cap';

/** Turn movers into bubbles. Shared with the full-page heat map. */
export function toBubbles(items: Mover[], sizeBy: SizeBy): Bubble[] {
  // Cap extreme moves so one outlier does not shrink everything else to the minimum size.
  const moves = items.map((m) => Math.abs(m.change ?? 0)).sort((a, b) => a - b);
  const cap = Math.max(1, (moves[Math.floor(moves.length * 0.92)] ?? 1) * 1.6);
  return items.map((m) => ({
    key: m.key,
    label: m.sym,
    change: m.change,
    image: m.image,
    weight: sizeBy === 'cap' ? Math.max(1, m.marketCap ?? 0) : Math.max(0.15, Math.min(cap, Math.abs(m.change ?? 0))),
  }));
}

/** How many bubbles suit a box: enough to be interesting, few enough that each stays readable. */
export function bubbleCount(host: HTMLElement, max = 50): number {
  const r = host.getBoundingClientRect();
  if (r.width < 40 || r.height < 40) return max;
  return Math.max(12, Math.min(max, Math.round((r.width * r.height) / 5200)));
}

export function mountMovers(leftEl: HTMLElement, rightEl: HTMLElement, bubbleEl: HTMLElement, scope: Scope): void {
  /* panels */
  const rowsNow: Record<Side, Row[]> = { left: [], right: [] };
  const loadPanels = () => {
    const cfg = panels.get();
    for (const side of ['left', 'right'] as Side[]) {
      const c = cfg[side];
      if (!isCryptoMovers(c.mode)) continue;
      const tab = chainTab(c.chain);
      if (tab.cat === 'solana') void loadSolana(c.tf, byVolume(c) ? 'volume' : c.mode === 'movers_up' ? 'up' : 'down');
      else loadCat(tab.cat, c.tf);
    }
  };
  const paintPanels = frame(() => {
    const cfg = panels.get();
    loadPanels();
    for (const side of ['left', 'right'] as Side[]) {
      const el = side === 'left' ? leftEl : rightEl;
      rowsNow[side] = panelRows(cfg[side]).rows;
      render(el, panelHtml(side, cfg[side]));
      flash(el);
    }
  });
  const want = () => {
    const cfg = panels.get();
    wantQuotes('panels', [...panelSymbols(cfg.left), ...panelSymbols(cfg.right)]);
  };
  scope.add(
    panels.subscribe(() => {
      want();
      paintPanels();
    }),
    crypto.subscribe(paintPanels),
    equities.subscribe(paintPanels),
    quotes.subscribe(paintPanels),
    eth.subscribe(paintPanels),
    bnb.subscribe(paintPanels),
    solana.subscribe(paintPanels),
    data.subscribe(() => {
      want();
      paintPanels();
    }),
    () => wantQuotes('panels', []),
  );
  want();
  paintPanels();

  for (const el of [leftEl, rightEl]) {
    const openRow = (id: string) => {
      const [side, i] = id.split(':') as [Side, string];
      const row = rowsNow[side][Number(i)];
      if (row?.href) window.open(row.href, '_blank', 'noopener');
      else if (row) openAsset(row.ref);
    };
    scope.add(
      on(el, 'click', '[data-panel-open]', (_ev, t) => openRow(t.dataset.panelOpen!)),
      on(el, 'keydown', '[data-panel-open]', (ev, t) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openRow(t.dataset.panelOpen!);
        }
      }),
      on(el, 'click', '[data-panel-tf]', (_ev, t) => {
        const [side, tf] = t.dataset.panelTf!.split(':') as [Side, string];
        const cfg = panels.get();
        const next = { ...cfg, [side]: { ...cfg[side], tf } };
        // Guests can flip the timeframe for this visit; signed-in users have it saved.
        savePanelsSoon(next);
      }),
      on(el, 'click', '[data-panel-chain]', (_ev, t) => {
        const [side, chain] = t.dataset.panelChain!.split(':') as [Side, PanelChain];
        const cfg = panels.get();
        savePanelsSoon({ ...cfg, [side]: { ...cfg[side], chain } });
      }),
      on(el, 'click', '[data-panel-rank]', (_ev, t) => {
        const [side, sort] = t.dataset.panelRank!.split(':') as [Side, PanelSort];
        const cfg = panels.get();
        savePanelsSoon({ ...cfg, [side]: { ...cfg[side], sort } });
      }),
      on(el, 'click', '[data-panel-edit]', (_ev, t) => {
        if (!user.get()) {
          openAuth();
          return;
        }
        openPanelEditor(t.dataset.panelEdit as Side);
      }),
    );
  }

  /* bubble map */
  let cat = pref('ov.bubbleCat', 'cryptos') as MoverCat;
  let tf = pref('ov.bubbleTf', '24h');
  let sizeBy = pref('ov.bubbleSize', 'move') as SizeBy;
  if (!MOVER_CATS.some((c) => c.id === cat)) cat = 'cryptos';

  bubbleEl.innerHTML = `<div class="card-head">
      <h2 class="card-title">${icon.bubbles(16)} Bubble map</h2>
      <div class="card-tools" data-size-tools></div>
      <div class="bubble-tools" data-tools></div>
    </div>
    <div class="bubble-host" data-host></div>
    <div class="card-foot"><span data-note></span><a href="/heatmap/">Full-size heat map ${icon.chevronRight(13)}</a></div>`;
  const host = bubbleEl.querySelector<HTMLElement>('[data-host]')!;
  let current = new Map<string, Mover>();
  const map: BubbleMap = createBubbleMap(host, {
    tooltip: (key) => {
      const m = current.get(key);
      return m ? moverTip(m, `Change, ${tfLabel(cat, tf)}`) : '';
    },
    onPick: (key) => {
      const m = current.get(key);
      if (!m) return;
      if (m.ref) openAsset(m.ref);
      else if (m.href) window.open(m.href, '_blank', 'noopener');
    },
  });
  scope.add(() => map.destroy());

  let lastKey = '';
  const paintBubbles = frame(() => {
    const options = tfOptions(cat);
    if (!options.some((o) => o.id === tf)) tf = options.some((o) => o.id === '24h') ? '24h' : options[0]!.id;
    render(
      bubbleEl.querySelector('[data-tools]'),
      `<div class="seg seg-scroll" role="group" aria-label="Market">${MOVER_CATS.map((c) => `<button type="button" class="seg-btn${c.id === cat ? ' is-on' : ''}" data-bubble-cat="${c.id}" aria-pressed="${c.id === cat ? 'true' : 'false'}" title="${c.title}">${c.label}</button>`).join('')}</div>
       <div class="seg" role="group" aria-label="Timeframe">${options.map((o) => `<button type="button" class="seg-btn${o.id === tf ? ' is-on' : ''}" data-bubble-tf="${o.id}" aria-pressed="${o.id === tf ? 'true' : 'false'}">${o.label}</button>`).join('')}</div>`,
    );
    render(
      bubbleEl.querySelector('[data-size-tools]'),
      `<div class="seg" role="group" aria-label="Bubble size">${([['move', 'By move'], ['cap', 'By value']] as const).map(([id, label]) => `<button type="button" class="seg-btn${id === sizeBy ? ' is-on' : ''}" data-bubble-size="${id}" aria-pressed="${id === sizeBy ? 'true' : 'false'}">${label}</button>`).join('')}</div>`,
    );
    loadCat(cat, tf);
    const res = biggestMoves(cat, tf, bubbleCount(host));
    current = new Map(res.items.map((m) => [m.key, m]));
    // Only re-pack when what is shown has changed; a price tick alone keeps the layout.
    const key = `${cat}|${tf}|${sizeBy}|${res.items.map((m) => `${m.key}:${(m.change ?? 0).toFixed(1)}`).join(',')}`;
    if (key !== lastKey) {
      lastKey = key;
      map.set(toBubbles(res.items, sizeBy), {
        exponent: sizeBy === 'cap' ? 0.3 : 0.5,
        emptyText: res.status === 'loading' ? 'Loading…' : res.status === 'error' ? 'This data is not available right now.' : 'Nothing moved enough to show here.',
      });
    }
    const source = isCoinCat(cat) ? 'CoinGecko' : cat === 'solana' ? 'Jupiter' : 'Yahoo Finance';
    const chainName = cat === 'bnb' ? 'BNB Chain' : 'Ethereum';
    const what =
      cat === 'cryptos'
        ? `${res.items.length} biggest moves among liquid top-250 coins`
        : cat === 'ethereum' || cat === 'bnb'
          ? coinState(cat).partial
            ? `${res.items.length} biggest moves among the ${chainName} tokens in the top 250 (full list not available right now)`
            : `${res.items.length} biggest moves among liquid ${chainName} tokens`
          : cat === 'solana'
          ? `${res.items.length} biggest moves among verified Solana tokens`
          : `${res.items.length} biggest moves in the ${cat === 'stocks' ? 'stock' : 'ETF'} list`;
    render(bubbleEl.querySelector('[data-note]'), res.items.length ? html`${what} · ${statusNote(res.status, res.at, source)}` : html`${statusNote(res.status, res.at, source)}`);
  });

  scope.add(
    crypto.subscribe(paintBubbles),
    equities.subscribe(paintBubbles),
    solana.subscribe(paintBubbles),
    eth.subscribe(paintBubbles),
    bnb.subscribe(paintBubbles),
    on(bubbleEl, 'click', '[data-bubble-cat]', (_ev, t) => {
      setPref('ov.bubbleCat', (cat = t.dataset.bubbleCat as MoverCat));
      paintBubbles();
    }),
    on(bubbleEl, 'click', '[data-bubble-tf]', (_ev, t) => {
      setPref('ov.bubbleTf', (tf = t.dataset.bubbleTf!));
      paintBubbles();
    }),
    on(bubbleEl, 'click', '[data-bubble-size]', (_ev, t) => {
      setPref('ov.bubbleSize', (sizeBy = t.dataset.bubbleSize as SizeBy));
      paintBubbles();
    }),
  );
  scope.interval(() => {
    loadCat(cat, tf);
    paintBubbles();
    paintPanels();
  }, 60_000);
  paintBubbles();
}
