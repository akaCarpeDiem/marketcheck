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
import { coinGeckoBars, coinGeckoCandles, coinOf, rangeStart, verifiedPair, yahooBars, type ChartMeta, type DailyRange } from '../data/history';
import { data, isWatched, pref, setPref, toggleWatch } from '../data/user';
import { esc, frame, html, raw, render } from '../lib/dom';
import { compact, dir, money, pct, price as fmtPrice, quantity, signedMoney } from '../lib/format';
import { icon } from '../lib/icons';
import { rangeBar } from '../lib/spark';
import { Scope } from '../lib/store';
import { setQuery } from '../router';
import { createChart, type Chart, type ChartLine, type ChartPoint } from './chart';
import { openHoldingForm } from './holding';
import { openOverlay, type Overlay } from './overlay';
import { toast } from './toast';

type RangeId = '1D' | '5D' | '7D' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y';

/**
 * A chart range. `lookback` fetches a longer series so moving averages can start on the left edge;
 * the chart then shows only the bars from `start`. `bar` names one bar for the average labels.
 */
type Spec = { id: RangeId; range: string; interval: string; bar: string; lookback?: string; start?: DailyRange; days?: number };

const YAHOO_RANGES: Spec[] = [
  { id: '1D', range: '1d', interval: '5m', bar: '5-min' },
  { id: '5D', range: '5d', interval: '15m', bar: '15-min' },
  { id: '1M', range: '1mo', interval: '60m', bar: 'hour' },
  { id: '6M', range: '6mo', interval: '1d', bar: 'day', lookback: '2y', start: '6M' },
  { id: 'YTD', range: 'ytd', interval: '1d', bar: 'day', lookback: '2y', start: 'YTD' },
  { id: '1Y', range: '1y', interval: '1d', bar: 'day', lookback: '2y', start: '1Y' },
  { id: '5Y', range: '5y', interval: '1wk', bar: 'week', lookback: '10y', start: '5Y' },
];

const COIN_RANGES: Spec[] = [
  { id: '1D', days: 1, range: '1d', interval: '15m', bar: '15-min' },
  { id: '7D', days: 7, range: '5d', interval: '60m', bar: 'hour' },
  { id: '1M', days: 30, range: '1mo', interval: '60m', bar: 'hour' },
  { id: '3M', days: 90, range: '3mo', interval: '1d', bar: 'day', lookback: '2y', start: '3M' },
  { id: '1Y', days: 365, range: '1y', interval: '1d', bar: 'day', lookback: '2y', start: '1Y' },
];

/** Benchmarks a chart can be compared against (Yahoo symbols). */
const BENCHMARKS: [string, string][] = [
  ['^GSPC', 'S&P 500'],
  ['^IXIC', 'Nasdaq'],
  ['BTC-USD', 'Bitcoin'],
  ['ETH-USD', 'Ether'],
  ['GC=F', 'Gold'],
];
const COMPARE_COLOUR = '#a78bfa';
/** Moving averages for daily and weekly bars. */
const AVERAGES = [50, 200];

type Tools = { mode: 'line' | 'candle'; vol: boolean; avg: boolean; cmp: string };

type SeriesResult = { points: ChartPoint[]; history?: ChartPoint[]; meta: ChartMeta | null; source: string } | { error: string };

const daily = (spec: Spec) => spec.bar === 'day' || spec.bar === 'week';

/** A Yahoo series for a range, with the lead-in for averages when the range has one. */
async function yahooSeries(symbol: string, spec: Spec): Promise<SeriesResult> {
  const y = await yahooBars(symbol, spec.lookback ?? spec.range, spec.interval);
  if (!y) return { error: 'No chart is available for this symbol.' };
  if (!spec.lookback || !spec.start) return { points: y.bars, meta: y.meta, source: 'Yahoo Finance' };
  const from = rangeStart(spec.start);
  const shown = y.bars.filter((b) => b.t >= from);
  return shown.length >= 2
    ? { points: shown, history: y.bars, meta: y.meta, source: 'Yahoo Finance' }
    : { points: y.bars, meta: y.meta, source: 'Yahoo Finance' };
}

async function loadSeries(ref: AssetRef, spec: Spec, tools: Tools): Promise<SeriesResult> {
  const coin = coinOf(ref);
  if (coin) {
    const days = spec.days ?? 1;
    // Candles, volume and averages over a long lead-in come from the coin's Yahoo pair when it is the same coin.
    if (tools.mode === 'candle' || tools.vol || (tools.avg && daily(spec))) {
      const pair = await verifiedPair(ref);
      if (pair) {
        try {
          const y = await yahooSeries(pair, spec);
          if ('points' in y) {
            const since = Date.now() - days * 86_400_000;
            if (spec.lookback) return y;
            const cut = y.points.filter((p) => p.t >= since);
            return { ...y, points: cut.length >= 2 ? cut : y.points };
          }
        } catch {
          /* CoinGecko below */
        }
      }
      if (tools.mode === 'candle') {
        try {
          const candles = await coinGeckoCandles(coin.id, days);
          if (candles) return { points: candles, meta: null, source: 'CoinGecko' };
        } catch {
          /* the line below */
        }
      }
    }
    try {
      const pts = await coinGeckoBars(coin.id, days);
      if (pts) return { points: pts, meta: null, source: 'CoinGecko' };
    } catch {
      /* Yahoo's pair below */
    }
    // Fall back to Yahoo's pair for this ticker, but only if it is clearly the same coin.
    try {
      const pair = await verifiedPair(ref);
      if (pair) {
        const y = await yahooSeries(pair, spec);
        if ('points' in y) {
          const since = Date.now() - days * 86_400_000;
          const cut = y.points.filter((p) => p.t >= since);
          return { ...y, points: cut.length >= 2 ? cut : y.points };
        }
      }
    } catch {
      /* nothing left */
    }
    return { error: 'A chart for this coin is not available right now.' };
  }
  if (ref.yahoo) {
    try {
      return await yahooSeries(ref.yahoo, spec);
    } catch {
      return { error: 'The chart could not be loaded. Try again in a moment.' };
    }
  }
  return { error: 'No chart is available for this asset.' };
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
let tools: Tools = {
  mode: pref('chart.mode', 'line') === 'candle' ? 'candle' : 'line',
  vol: pref('chart.vol', true),
  avg: pref('chart.avg', false),
  cmp: '',
};
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
        <a class="icon-btn" href="/compare/?s=${encodeURIComponent(assetQuery(ref))},%5EGSPC" data-sheet-compare title="Compare with other assets" aria-label="Compare with other assets">${raw(icon.chart(17))}</a>
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

function specsFor(ref: AssetRef): Spec[] {
  const isCoin = !!ref.cg || (ref.kind === 'crypto' && !!ref.yahoo && !!coinForPair(ref.yahoo));
  return isCoin ? COIN_RANGES : YAHOO_RANGES;
}
const rangesFor = (ref: AssetRef): RangeId[] => specsFor(ref).map((r) => r.id);
const specFor = (ref: AssetRef): Spec => specsFor(ref).find((r) => r.id === rangeId) ?? specsFor(ref)[0]!;

/** The benchmarks offered for an asset: never the asset itself. */
function benchmarksFor(ref: AssetRef): [string, string][] {
  const coin = coinOf(ref);
  const own = (ref.yahoo ?? (coin ? `${coin.symbol}-USD` : '')).toUpperCase();
  return BENCHMARKS.filter(([sym]) => sym !== own);
}

function paintTools(): void {
  if (!overlay || !current) return;
  const spec = specFor(current);
  const cmp = tools.cmp;
  const btn = (tool: string, on: boolean, label: string, title: string, disabled = false) =>
    `<button type="button" class="chip-btn${on ? ' is-on' : ''}" data-tool="${tool}" aria-pressed="${on}" title="${esc(title)}"${disabled ? ' disabled' : ''}>${label}</button>`;
  const options = benchmarksFor(current)
    .map(([sym, label]) => `<option value="${esc(sym)}"${sym === cmp ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');
  render(
    overlay.panel.querySelector('.chart-tools'),
    `<div class="seg" role="group" aria-label="Chart type">
      <button type="button" class="seg-btn${tools.mode === 'line' ? ' is-on' : ''}" data-tool="mode" data-value="line" aria-pressed="${tools.mode === 'line'}" title="Line chart">${icon.chart(14)}<span>Line</span></button>
      <button type="button" class="seg-btn${tools.mode === 'candle' ? ' is-on' : ''}" data-tool="mode" data-value="candle" aria-pressed="${tools.mode === 'candle'}"${cmp ? ' disabled' : ''} title="Candlestick chart: each bar shows open, high, low and close"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 1v12M10.5 2v10" stroke="currentColor" stroke-width="1.4"/><rect x="1.8" y="4" width="3.4" height="5.5" rx="1" fill="currentColor"/><rect x="8.8" y="3.5" width="3.4" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg><span>Candles</span></button>
    </div>
    ${btn('vol', tools.vol && !cmp, 'Volume', cmp ? 'Not shown while comparing' : 'Show traded volume under the price', !!cmp)}
    ${btn('avg', tools.avg && daily(spec), `${AVERAGES.join('/')} ${spec.bar === 'week' ? 'week' : 'day'} avg`, daily(spec) ? 'Moving averages: the average closing price over the last 50 and 200 bars' : 'Averages need daily bars: pick 3M or longer', !daily(spec) || !!cmp)}
    <label class="chip-select${cmp ? ' is-on' : ''}" title="Compare the move with a benchmark"><span>vs</span><select data-tool="cmp" aria-label="Compare with"><option value="">Compare…</option>${options}</select></label>`,
  );
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
  const spec = specFor(ref);
  paintRanges();
  paintTools();
  overlay?.panel.querySelector('.sheet-chart')?.classList.add('is-loading');
  const cmpSym = tools.cmp;
  const [res, cmp] = await Promise.all([
    loadSeries(ref, spec, tools),
    cmpSym ? yahooBars(cmpSym, spec.range, spec.interval).catch(() => null) : Promise.resolve(null),
  ]);
  if (token !== loadToken || !chart || current !== ref) return;
  overlay?.panel.querySelector('.sheet-chart')?.classList.remove('is-loading');
  if ('error' in res) {
    chartSource = '';
    chart.clear(res.error);
  } else {
    if (res.meta) meta = res.meta;
    chartSource = res.source;
    const p = lookup(ref);
    const points = res.points.map((x) => ({ ...x }));
    // End the line on the live price so the chart and the headline number agree (if they are the same thing).
    const last = points[points.length - 1];
    if (p.price != null && last && Math.abs(p.price / last.v - 1) < 0.15) {
      last.v = p.price;
      if (last.h != null) last.h = Math.max(last.h, p.price);
      if (last.l != null) last.l = Math.min(last.l, p.price);
    }
    const compare: ChartLine[] = [];
    if (cmpSym && cmp && cmp.bars.length > 1) {
      const label = BENCHMARKS.find(([s]) => s === cmpSym)?.[1] ?? cmpSym;
      compare.push({ label, colour: COMPARE_COLOUR, points: cmp.bars });
    }
    chart.set(points, {
      baseline: rangeId === '1D' && !p.coin ? (p.prevClose ?? res.meta?.prevClose ?? null) : null,
      formatValue: (v) => priceText(ref, v),
      formatTime: tipTime,
      formatAxisTime: axisTime,
      mode: tools.mode,
      volume: tools.vol,
      averages: tools.avg && daily(spec) ? AVERAGES : [],
      barName: spec.bar,
      history: res.history,
      compare,
      label: ref.sym,
    });
    if (cmpSym && !compare.length) toast('That comparison is not available right now.', 'bad');
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
    tools.cmp = '';
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
  tools.cmp = '';
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
        <div class="sheet-chart-bar">
          <div class="seg sheet-ranges" role="group" aria-label="Chart range"></div>
          <div class="chart-tools"></div>
        </div>
        <div class="sheet-chart"></div>
        <p class="chart-hint faint">Press and drag across the chart to measure a move.</p>
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
    // The compare link leaves for another page: close the sheet and let the router follow the link.
    if (t.closest('[data-sheet-compare]')) {
      overlay?.close();
      return;
    }
    const tool = t.closest<HTMLElement>('button[data-tool]');
    if (tool && current && !tool.hasAttribute('disabled')) {
      const which = tool.dataset.tool;
      if (which === 'mode') {
        tools.mode = tool.dataset.value === 'candle' ? 'candle' : 'line';
        setPref('chart.mode', tools.mode);
        if (tools.mode === 'candle') tools.cmp = '';
      } else if (which === 'vol') {
        tools.vol = !tools.vol;
        setPref('chart.vol', tools.vol);
      } else if (which === 'avg') {
        tools.avg = !tools.avg;
        setPref('chart.avg', tools.avg);
        if (tools.avg) tools.cmp = '';
      }
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

  panel.addEventListener('change', (ev) => {
    const sel = (ev.target as Element).closest<HTMLSelectElement>('select[data-tool="cmp"]');
    if (!sel) return;
    tools.cmp = sel.value;
    // A comparison is a line in percent: candles and averages step aside while it is on.
    if (tools.cmp) tools.mode = 'line';
    void loadChart();
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
