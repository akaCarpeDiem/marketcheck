/**
 * The asset sheet: everything about one stock, fund, index, future or coin —
 * price, a chart with ranges, key figures, background and actions.
 * Opens over the page; the address gets ?q=SYMBOL so it can be shared.
 */
import type { CryptoTf } from '../../functions/_shared/cryptoUniverse';
import type { EquityTf } from '../../functions/_shared/equityUniverse';
import {
  avatar,
  coinForPair,
  externalLinks,
  KIND_LABEL,
  lookup,
  priceText,
  refFromCoin,
  refFromEquity,
  refFromYahoo,
  unitSuffix,
  type AssetRef,
  type Priced,
} from '../data/assets';
import { crypto, equities, quotes, wantQuotes } from '../data/market';
import { profileFor } from '../data/profiles';
import { data, isWatched, toggleWatch } from '../data/user';
import { getJson } from '../lib/api';
import { esc, frame, html, raw, render } from '../lib/dom';
import { compact, dir, money, pct, price as fmtPrice, quantity, signedMoney } from '../lib/format';
import { icon } from '../lib/icons';
import { rangeBar } from '../lib/spark';
import { Scope } from '../lib/store';
import { setQuery } from '../router';
import { createChart, type Chart, type ChartPoint } from './chart';
import { openHoldingForm } from './holding';
import { openOverlay, type Overlay } from './overlay';
import { toast } from './toast';

type RangeId = '1D' | '5D' | '7D' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y';

const YAHOO_RANGES: { id: RangeId; range: string; interval: string }[] = [
  { id: '1D', range: '1d', interval: '5m' },
  { id: '5D', range: '5d', interval: '15m' },
  { id: '1M', range: '1mo', interval: '60m' },
  { id: '6M', range: '6mo', interval: '1d' },
  { id: 'YTD', range: 'ytd', interval: '1d' },
  { id: '1Y', range: '1y', interval: '1d' },
  { id: '5Y', range: '5y', interval: '1wk' },
];

const COIN_RANGES: { id: RangeId; days: number; range: string; interval: string }[] = [
  { id: '1D', days: 1, range: '1d', interval: '15m' },
  { id: '7D', days: 7, range: '5d', interval: '60m' },
  { id: '1M', days: 30, range: '1mo', interval: '60m' },
  { id: '3M', days: 90, range: '3mo', interval: '1d' },
  { id: '1Y', days: 365, range: '1y', interval: '1d' },
];

type ChartMeta = {
  prevClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  high52: number | null;
  low52: number | null;
  exchange: string | null;
  name: string | null;
  price: number | null;
};

type SeriesResult = { points: ChartPoint[]; meta: ChartMeta | null; source: string } | { error: string };

type ChartPayload = {
  ok?: boolean;
  closes?: number[];
  timestamps?: number[];
  meta?: ChartMeta | null;
};

const seriesCache = new Map<string, { at: number; value: SeriesResult }>();

async function yahooSeries(symbol: string, range: string, interval: string): Promise<SeriesResult> {
  const d = await getJson<ChartPayload>(
    `/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`,
    { timeout: 20_000 },
  );
  const closes = d.closes ?? [];
  const stamps = d.timestamps ?? [];
  if (!d.ok || closes.length < 2 || stamps.length !== closes.length) return { error: 'No chart is available for this symbol.' };
  return {
    points: closes.map((v, i) => ({ t: stamps[i]! * 1000, v })),
    meta: d.meta ?? null,
    source: 'Yahoo Finance',
  };
}

/** CoinGecko's public chart endpoint, called from the browser. */
async function coinGeckoSeries(id: string, days: number): Promise<SeriesResult> {
  const d = await getJson<{ prices?: [number, number][] }>(
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`,
    { timeout: 9000 },
  );
  const rows = (d.prices ?? []).filter((r) => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1]));
  if (rows.length < 2) return { error: 'No chart is available for this coin.' };
  // Thin very long series; a few hundred points is plenty for the width.
  const step = Math.max(1, Math.floor(rows.length / 360));
  const points: ChartPoint[] = [];
  for (let i = 0; i < rows.length; i += step) points.push({ t: rows[i]![0], v: rows[i]![1] });
  const last = rows[rows.length - 1]!;
  if (points[points.length - 1]!.t !== last[0]) points.push({ t: last[0], v: last[1] });
  return { points, meta: null, source: 'CoinGecko' };
}

async function loadSeries(ref: AssetRef, rangeId: RangeId): Promise<SeriesResult> {
  const key = `${ref.key}|${rangeId}`;
  const hit = seriesCache.get(key);
  const maxAge = rangeId === '1D' ? 60_000 : 5 * 60_000;
  if (hit && Date.now() - hit.at < maxAge) return hit.value;

  let value: SeriesResult;
  const coin = ref.cg ? crypto.get().byId.get(ref.cg) : ref.kind === 'crypto' && ref.yahoo ? coinForPair(ref.yahoo) : null;
  if (coin) {
    const spec = COIN_RANGES.find((r) => r.id === rangeId) ?? COIN_RANGES[0]!;
    try {
      value = await coinGeckoSeries(coin.id, spec.days);
    } catch {
      value = { error: 'unavailable' };
    }
    if ('error' in value) {
      // Fall back to Yahoo's pair for this ticker, but only if it is clearly the same coin.
      try {
        const y = await yahooSeries(ref.yahoo ?? `${coin.symbol}-USD`, spec.range, spec.interval);
        const lastPrice = 'points' in y ? y.points[y.points.length - 1]!.v : null;
        if ('points' in y && coin.price != null && lastPrice != null && Math.abs(lastPrice / coin.price - 1) < 0.05) {
          const since = Date.now() - spec.days * 86_400_000;
          const cut = y.points.filter((p) => p.t >= since);
          value = { ...y, points: cut.length >= 2 ? cut : y.points };
        } else {
          value = { error: 'A chart for this coin is not available right now.' };
        }
      } catch {
        value = { error: 'A chart for this coin is not available right now.' };
      }
    }
  } else if (ref.yahoo) {
    const spec = YAHOO_RANGES.find((r) => r.id === rangeId) ?? YAHOO_RANGES[0]!;
    try {
      value = await yahooSeries(ref.yahoo, spec.range, spec.interval);
    } catch {
      value = { error: 'The chart could not be loaded. Try again in a moment.' };
    }
  } else {
    value = { error: 'No chart is available for this asset.' };
  }
  if ('points' in value) seriesCache.set(key, { at: Date.now(), value });
  return value;
}

const fmtShort = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtDayTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fmtDayYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fmtMonthYear = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' });
const DAY = 86_400_000;

const tipTime = (ms: number, span: number): string =>
  span <= 8 * DAY ? fmtDayTime.format(ms) : span <= 45 * DAY ? fmtDayTime.format(ms) : fmtDayYear.format(ms);
const axisTime = (ms: number, span: number): string =>
  span <= 1.5 * DAY ? fmtShort.format(ms) : span <= 200 * DAY ? fmtDay.format(ms) : fmtMonthYear.format(ms);

/* ── The sheet ─────────────────────────────────────────────────────────── */

let overlay: Overlay | null = null;
let scope: Scope | null = null;
let chart: Chart | null = null;
let current: AssetRef | null = null;
let rangeId: RangeId = '1D';
let meta: ChartMeta | null = null;
let chartSource = '';
let loadToken = 0;

function stat(label: string, value: string, extra = ''): string {
  return `<div class="stat"><dt>${esc(label)}</dt><dd class="num">${value}${extra}</dd></div>`;
}

function changeChips(p: Priced): string {
  const chip = (label: string, v: number | null | undefined) =>
    v == null ? '' : `<span class="chg-chip ${dir(v)}"><em>${label}</em><b class="num">${pct(v)}</b></span>`;
  if (p.coin) {
    const tfs: CryptoTf[] = ['1h', '4h', '8h', '24h', '7d', '30d', '1y'];
    return tfs.map((tf) => chip(tf, p.coin!.ch[tf])).join('');
  }
  if (p.equity) {
    const tfs: [EquityTf, string][] = [['24h', '1D'], ['7d', '1W'], ['30d', '1M'], ['ytd', 'YTD'], ['1y', '1Y']];
    return tfs.map(([tf, label]) => chip(label, p.equity!.ch[tf])).join('');
  }
  return '';
}

function headHtml(ref: AssetRef, p: Priced): string {
  const watched = isWatched(ref.key);
  const d = dir(p.change);
  const abs = p.price != null && p.prevClose != null ? p.price - p.prevClose : null;
  const exchange = meta?.exchange && !p.coin ? ` · ${esc(meta.exchange)}` : '';
  return html`<div class="sheet-top">
      <div class="sheet-id">
        ${raw(avatar(ref, p.image, 44))}
        <div class="sheet-names">
          <h2>${ref.name}</h2>
          <p><span class="tag">${ref.sym}</span><span class="muted">${KIND_LABEL[ref.kind]}${raw(exchange)}</span></p>
        </div>
      </div>
      <div class="sheet-actions">
        <button type="button" class="icon-btn${watched ? ' is-on' : ''}" data-sheet="watch" aria-pressed="${watched ? 'true' : 'false'}" title="${watched ? 'Remove from watchlist' : 'Add to watchlist'}" aria-label="${watched ? 'Remove from watchlist' : 'Add to watchlist'}">${raw(watched ? icon.starFill(17) : icon.star(17))}</button>
        <button type="button" class="icon-btn" data-sheet="share" title="Copy a link to this" aria-label="Copy a link to this">${raw(icon.link(17))}</button>
        <button type="button" class="icon-btn" data-close title="Close" aria-label="Close">${raw(icon.close(17))}</button>
      </div>
    </div>
    <div class="sheet-price">
      <div class="sheet-price-main">
        <strong class="num" data-flash="${ref.key}">${priceText(ref, p.price)}<small>${unitSuffix(ref)}</small></strong>
        <span class="pill ${d} num">${pct(p.change)}</span>
        ${raw(abs != null && !ref.cg && ref.kind !== 'index' ? `<span class="num ${d}">${signedMoney(abs, Math.abs(abs) < 1 ? 4 : 2)}</span>` : '')}
        <span class="muted">${p.coin ? '24h' : 'today'}</span>
      </div>
      ${raw(p.stale ? '<span class="tag tag-warn">Delayed</span>' : '')}
    </div>`;
}

function statsHtml(ref: AssetRef, p: Priced): string {
  const rows: string[] = [];
  const u = (v: number | null | undefined) => (v == null ? '—' : priceText(ref, v));
  if (p.coin) {
    const c = p.coin;
    rows.push(stat('Market cap', compact(c.marketCap), c.rank ? ` <span class="muted">#${c.rank}</span>` : ''));
    rows.push(stat('24h volume', compact(c.volume)));
    if (c.low24 != null && c.high24 != null) rows.push(stat('24h range', `${fmtPrice(c.low24)} – ${fmtPrice(c.high24)}`, rangeBar(c.low24, c.high24, c.price)));
    if (c.ath != null) rows.push(stat('All-time high', fmtPrice(c.ath), c.athChange != null ? ` <span class="${dir(c.athChange)}">${pct(c.athChange, 1)}</span>` : ''));
    if (c.supply != null) rows.push(stat('Circulating supply', `${quantity(Math.round(c.supply))} ${esc(c.symbol)}`));
  } else {
    if (p.marketCap != null) rows.push(stat(ref.kind === 'etf' ? 'Assets' : 'Market cap', compact(p.marketCap)));
    rows.push(stat('Previous close', u(p.prevClose ?? meta?.prevClose)));
    if (meta?.dayLow != null && meta.dayHigh != null) rows.push(stat('Day range', `${u(meta.dayLow)} – ${u(meta.dayHigh)}`, rangeBar(meta.dayLow, meta.dayHigh, p.price)));
    const lo = p.equity?.low52 ?? meta?.low52 ?? null;
    const hi = p.equity?.high52 ?? meta?.high52 ?? null;
    if (lo != null && hi != null) rows.push(stat('52-week range', `${u(lo)} – ${u(hi)}`, rangeBar(lo, hi, p.price)));
    if (meta?.volume != null && meta.volume > 0 && ref.kind !== 'index' && ref.kind !== 'fx') {
      rows.push(stat('Volume today', quantity(meta.volume)));
    }
    if (p.equity) rows.push(stat(ref.kind === 'etf' ? 'Group' : 'Sector', esc(p.equity.group)));
  }
  return rows.join('');
}

function positionHtml(ref: AssetRef, p: Priced): string {
  const h = data.get().holdings.find((x) => x.ref.key === ref.key);
  if (!h) {
    return `<button type="button" class="btn btn-outline" data-sheet="hold">${icon.plus(15)} Add to portfolio</button>`;
  }
  const value = p.price != null ? h.qty * p.price : null;
  const gain = p.price != null && h.cost != null ? (p.price - h.cost) * h.qty : null;
  const gainPct = p.price != null && h.cost ? (p.price / h.cost - 1) * 100 : null;
  return html`<div class="position">
    <div><span class="muted">You hold</span><strong class="num">${quantity(h.qty)} ${ref.sym}</strong></div>
    <div><span class="muted">Worth</span><strong class="num">${money(value)}</strong></div>
    ${raw(gain != null ? `<div><span class="muted">Gain</span><strong class="num ${dir(gain)}">${signedMoney(gain)} <small>${pct(gainPct)}</small></strong></div>` : '')}
    <button type="button" class="btn btn-ghost btn-sm" data-sheet="hold">${raw(icon.edit(14))} Edit</button>
  </div>`;
}

function aboutHtml(ref: AssetRef): string {
  const pr = profileFor(ref);
  if (!pr) return '';
  const founders = pr.founders?.length
    ? pr.founders
        .map((f) =>
          f.x
            ? `<a href="https://x.com/${encodeURIComponent(f.x.replace(/^@/, ''))}" target="_blank" rel="noopener noreferrer">${esc(f.name)}</a>`
            : esc(f.name),
        )
        .join(', ')
    : pr.founder
      ? esc(pr.founder)
      : '';
  return html`<section class="sheet-about">
    <h3>About</h3>
    <p>${pr.purpose}</p>
    <dl class="about-facts">
      ${raw(pr.founded ? `<div><dt>Started</dt><dd>${esc(pr.founded)}</dd></div>` : '')}
      ${raw(founders ? `<div><dt>${pr.founders && pr.founders.length > 1 ? 'Founders' : 'Founded by'}</dt><dd>${founders}</dd></div>` : '')}
    </dl>
  </section>`;
}

function paintExtra(): void {
  if (!overlay || !current) return;
  const links = externalLinks(current)
    .map((l) => `<a class="btn btn-ghost btn-sm" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ${icon.external(13)}</a>`)
    .join('');
  render(overlay.panel.querySelector('.sheet-extra'), `${aboutHtml(current)}<div class="sheet-links"><span class="muted">Open on</span>${links}</div>`);
}

/** A sheet opened from a bare ?q= may not know the asset's name yet; fill it in once a feed does. */
function upgradeRef(): void {
  if (!current || current.name !== current.sym) return;
  const better = refFromQuery(assetQuery(current));
  if (better && better.name !== better.sym) current = better;
}

function paint(): void {
  if (!overlay || !current) return;
  upgradeRef();
  const ref = current;
  const p = lookup(ref);
  const panel = overlay.panel;
  render(panel.querySelector('.sheet-head'), headHtml(ref, p));
  render(panel.querySelector('.sheet-chips'), changeChips(p));
  render(panel.querySelector('.sheet-stats'), statsHtml(ref, p));
  render(panel.querySelector('.sheet-position'), positionHtml(ref, p));
  render(
    panel.querySelector('.sheet-source'),
    html`Price: ${p.source}${chartSource && chartSource !== p.source ? ` · Chart: ${chartSource}` : ''}. Third-party data, may be delayed. Not advice.`,
  );
}

function rangesFor(ref: AssetRef): RangeId[] {
  const isCoin = !!ref.cg || (ref.kind === 'crypto' && !!ref.yahoo && !!coinForPair(ref.yahoo));
  return (isCoin ? COIN_RANGES : YAHOO_RANGES).map((r) => r.id);
}

function paintRanges(): void {
  if (!overlay || !current) return;
  const ids = rangesFor(current);
  render(
    overlay.panel.querySelector('.sheet-ranges'),
    ids
      .map(
        (id) =>
          `<button type="button" class="seg-btn${id === rangeId ? ' is-on' : ''}" data-range="${id}" aria-pressed="${id === rangeId ? 'true' : 'false'}">${id}</button>`,
      )
      .join(''),
  );
}

async function loadChart(): Promise<void> {
  if (!current || !chart) return;
  const ref = current;
  const token = (loadToken += 1);
  const ids = rangesFor(ref);
  if (!ids.includes(rangeId)) rangeId = ids[0]!;
  paintRanges();
  overlay?.panel.querySelector('.sheet-chart')?.classList.add('is-loading');
  const res = await loadSeries(ref, rangeId);
  if (token !== loadToken || !chart || current !== ref) return;
  overlay?.panel.querySelector('.sheet-chart')?.classList.remove('is-loading');
  if ('error' in res) {
    chartSource = '';
    chart.clear(res.error);
  } else {
    if (res.meta) meta = res.meta;
    chartSource = res.source;
    const p = lookup(ref);
    const points = res.points.slice();
    // End the line on the live price so the chart and the headline number agree.
    if (p.price != null && points.length) points[points.length - 1] = { t: points[points.length - 1]!.t, v: p.price };
    chart.set(points, {
      baseline: rangeId === '1D' && !p.coin ? (p.prevClose ?? res.meta?.prevClose ?? null) : null,
      formatValue: (v) => priceText(ref, v),
      formatTime: tipTime,
      formatAxisTime: axisTime,
    });
  }
  paint();
}

/** The address-bar form of an asset: a Yahoo symbol, or c:<coingecko id>. */
export const assetQuery = (ref: AssetRef): string => (ref.cg ? `c:${ref.cg}` : (ref.yahoo ?? ref.sym));

/** Work out which asset a ?q= value means. */
export function refFromQuery(q: string): AssetRef | null {
  const raw = q.trim();
  if (!raw || raw.length > 64) return null;
  if (/^c:/i.test(raw)) {
    const id = raw.slice(2).toLowerCase();
    if (!/^[a-z0-9\-_.]+$/.test(id)) return null;
    const coin = crypto.get().byId.get(id);
    return coin ? refFromCoin(coin) : { key: `c:${id}`, sym: id.toUpperCase().slice(0, 12), name: id, kind: 'crypto', cg: id };
  }
  if (!/^[A-Za-z0-9.^=\-]{1,24}$/.test(raw)) return null;
  const sym = raw.toUpperCase();
  const e = equities.get().bySymbol.get(sym);
  if (e) return refFromEquity(e);
  // A bare ticker that is a top coin and not a known stock means the coin.
  const coin = crypto.get().bySymbol.get(sym);
  if (coin && coin.rank <= 100 && equities.get().items.length) return refFromCoin(coin);
  const name = quotes.get().get(sym)?.name;
  return refFromYahoo(sym, undefined, name);
}

export function closeAsset(): void {
  overlay?.close();
}

export function openAsset(ref: AssetRef, opts: { updateUrl?: boolean } = {}): void {
  if (overlay?.isOpen() && current?.key === ref.key) return;
  if (overlay?.isOpen()) {
    // Swap the contents in place when moving from one asset to another.
    current = ref;
    meta = null;
    chartSource = '';
    if (ref.yahoo && !ref.cg) wantQuotes('sheet', [ref.yahoo]);
    paint();
    paintExtra();
    void loadChart();
    if (opts.updateUrl !== false) setQuery({ q: assetQuery(ref) }, { replace: true });
    return;
  }
  current = ref;
  meta = null;
  chartSource = '';
  rangeId = '1D';
  scope = new Scope();
  overlay = openOverlay({
    kind: 'sheet',
    label: `${ref.name} details`,
    focus: '[data-close]',
    onClose: () => {
      scope?.dispose();
      scope = null;
      chart?.destroy();
      chart = null;
      overlay = null;
      current = null;
      wantQuotes('sheet', []);
      setQuery({ q: null }, { replace: true });
    },
  });
  const panel = overlay.panel;
  panel.innerHTML = `<div class="sheet-head"></div>
    <div class="sheet-body scroll">
      <div class="sheet-chips"></div>
      <div class="sheet-chart-wrap">
        <div class="seg sheet-ranges" role="group" aria-label="Chart range"></div>
        <div class="sheet-chart"></div>
      </div>
      <dl class="sheet-stats"></dl>
      <div class="sheet-position"></div>
      <div class="sheet-extra"></div>
      <p class="sheet-source faint"></p>
    </div>`;
  chart = createChart(panel.querySelector<HTMLElement>('.sheet-chart')!);

  panel.addEventListener('click', (ev) => {
    const t = ev.target as Element;
    const range = t.closest<HTMLElement>('[data-range]');
    if (range && current) {
      rangeId = range.dataset.range as RangeId;
      void loadChart();
      return;
    }
    const act = t.closest<HTMLElement>('[data-sheet]')?.dataset.sheet;
    if (!act || !current) return;
    if (act === 'watch') {
      const res = toggleWatch(current);
      toast(res === 'full' ? 'Your watchlist is full.' : res ? `${current.sym} added to your watchlist.` : `${current.sym} removed from your watchlist.`, res === 'full' ? 'bad' : 'info');
    } else if (act === 'share') {
      const url = `${location.origin}/?q=${encodeURIComponent(assetQuery(current))}`;
      navigator.clipboard?.writeText(url).then(
        () => toast('Link copied.', 'good'),
        () => toast(url),
      );
    } else if (act === 'hold') {
      openHoldingForm(current);
    }
  });

  if (ref.yahoo && !ref.cg) wantQuotes('sheet', [ref.yahoo]);
  const repaint = frame(() => {
    paint();
    paintExtra();
  });
  scope.add(crypto.subscribe(repaint), equities.subscribe(repaint), quotes.subscribe(repaint), data.subscribe(repaint));
  paint();
  paintExtra();
  void loadChart();
  if (opts.updateUrl !== false) setQuery({ q: assetQuery(ref) }, { replace: true });
}

/** Open the sheet named in ?q=, once the feeds can tell what it is. */
export function openFromLocation(): void {
  const q = new URL(location.href).searchParams.get('q');
  if (!q) {
    if (overlay?.isOpen()) overlay.close();
    return;
  }
  const ref = refFromQuery(q);
  if (ref) openAsset(ref, { updateUrl: false });
}
