import './style.css';
import { adSlotHtml, ensureAdSenseScript, pushAds } from './ads';
import { initAnalytics } from './analytics';
import {
  CRYPTO_FALLBACK,
  fetchTopCryptos,
  filterL1Cryptos,
} from './api/coingecko';
import { fetchChartSeries, fetchSparklineBatch, sparklineSvg } from './api/chart';
import {
  HERO_SYMBOLS,
  INDEX_SYMBOLS,
  TOP_ETF_SYMBOLS,
  TOP_STOCK_SYMBOLS,
  fetchYahooMarketCaps,
  fetchYahooQuotes,
  symbolWantsMarketCap,
  toMarketQuote,
  uniqueYahooSymbols,
  type HeroAssetDef,
} from './api/yahoo';
import {
  fetchMe,
  fetchHeroLayout,
  saveHeroLayout,
  fetchIndexLayout,
  saveIndexLayout,
  fetchPanelsLayout,
  savePanelsLayout,
  fetchAssets,
  loginUrl,
  microsoftLoginUrl,
  logout,
  requestMagicLink,
  verifyMagicCode,
  DEFAULT_PANELS,
  panelShowsTfBar,
  METALS_PRESET,
  type AuthUser,
  type PanelConfig,
  type PanelsLayout,
  type PanelMode,
  type PanelSort,
} from './api/auth';
import { fetchBubbles } from './api/bubbles';
import { fetchTrending, type TrendingTf } from './api/trending';
import { fetchHeadlines, type HeadlineCategory } from './api/headlines';
import { paintBubbleMap, resetBubbleAnimState } from './components/bubbleMap';
import {
  chartUrlFor,
  describeAsset,
  describeAssetHtml,
} from './descriptions';
import {
  formatIndex,
  formatMetal,
  formatMoney,
  formatOil,
  formatPct,
  formatMktCap,
  pctClass,
} from './format';
import { stockLogoUrl } from './stockLogos';
import { nyseHoursEstimate } from './marketHours';
import {
  loadWatchlist,
  saveWatchlist,
  clearWatchlist,
  toggleWatchlist,
  isOnWatchlist,
  type WatchItem,
} from './watchlist';
import type {
  BubbleCategory,
  BubbleItem,
  CryptoRow,
  MarketQuote,
  Timeframe,
  TrendingItem,
  HeadlineItem,
} from './types';

const REFRESH_MS = Number(import.meta.env.VITE_REFRESH_MS) || 45_000;
const CHART_REFRESH_MS = 15 * 60_000;
const BUBBLE_REFRESH_MS = 90_000;
const TRENDING_REFRESH_MS = 120_000;
const HEADLINES_REFRESH_MS = 6 * 60_000;
const HEADLINE_ROTATE_MS = 7_000;
const TOOLTIP_DELAY_MS = 250;
/** Time to reach a rich tip (founder X links) after leaving the ticker */
const TIP_REACH_GRACE_MS = 1000;

/**
 * Assumed next Bitcoin halving target: 2028-04-17 00:00:00 UTC.
 * Approximate community estimate for the ~210,000-block cycle after the April 2024 halving;
 * not block-height exact — used only for the compact countdown ticker.
 */
const NEXT_HALVING_UTC = Date.UTC(2028, 3, 17, 0, 0, 0);

const HERO_SPARK_COLORS: Record<string, string> = {
  btc: '#f7931a',
  wti: '#6a6a6a',
  gold: '#d4a84b',
  silver: '#a8b4c4',
  spx: '#6b8cce',
  ndx: '#6b8cce',
};

const INDEX_SPARK_COLOR = '#3dd6c6';


type AppState = {
  user: AuthUser | null;
  heroDefs: HeroAssetDef[];
  indexDefs: HeroAssetDef[];
  authNote: string;
  hero: MarketQuote[];
  stocks: MarketQuote[];
  etfs: MarketQuote[];
  indexes: MarketQuote[];
  cryptos: CryptoRow[];
  equityKind: 'stocks' | 'etfs';
  cryptoKind: 'all' | 'l1s';
  cryptoListLimit: 10 | 25;
  equityListLimit: 10 | 25;
  bubbles: BubbleItem[];
  bubbleCategory: BubbleCategory;
  bubbleTf: Timeframe;
  bubbleTfLabel: string;
  bubbleNote: string;
  bubbleLimitation: string;
  bubbleRateLimited: boolean;
  bubbleStatus: 'ok' | 'stale' | 'loading' | 'err';
  trendingPumps: TrendingItem[];
  trendingDumps: TrendingItem[];
  trending: TrendingItem[]; // pumps+dumps concat (compat)
  trendingPumpsTf: TrendingTf;
  trendingDumpsTf: TrendingTf;
  trendingPumpsNote: string;
  trendingDumpsNote: string;
  trendingNote: string;
  trendingStale: boolean;
  trendingRateLimited: boolean;
  trendingPumpsStatus: 'ok' | 'stale' | 'loading' | 'err';
  trendingDumpsStatus: 'ok' | 'stale' | 'loading' | 'err';
  trendingStatus: 'ok' | 'stale' | 'loading' | 'err';
  /** Customizable left/right movers panels (guests keep defaults). */
  panels: PanelsLayout;
  /** True when volume_7d/30d fell back to 24h for that side. */
  panelVolumeFallback: { left: boolean; right: boolean };
  headlines: HeadlineItem[];
  headlineCategory: HeadlineCategory;
  headlineSlide: number;
  headlinesNote: string;
  headlinesThin: boolean;
  headlinesStale: boolean;
  headlinesFeeds: string[];
  headlinesStatus: 'ok' | 'thin' | 'stale' | 'loading' | 'err';
  /** Category switch animation: exit → enter (wobble) → idle */
  headlineAnim: 'idle' | 'exit' | 'enter';
  lastOkAt: Date | null;
  lastAttemptAt: Date | null;
  /** Per-feed as-of times for module footers */
  cryptoAsOf: Date | null;
  yahooAsOf: Date | null;
  headlinesAsOf: Date | null;
  /** True when crypto table is on CRYPTO_FALLBACK placeholders */
  cryptoUnavailable: boolean;
  status: 'ok' | 'stale' | 'err' | 'loading';
  sourcesNote: string;
  halvingText: string;
};

const state: AppState = {
  user: null,
  heroDefs: HERO_SYMBOLS.map((d) => ({ ...d })),
  indexDefs: INDEX_SYMBOLS.map((d) => ({ ...d })),
  authNote: '',
  hero: HERO_SYMBOLS.map((d) => ({
    id: d.id,
    symbol: d.yahoo,
    label: d.label,
    price: null,
    changePercent: null,
    unit: d.unit,
    ok: false,
    source: 'yahoo',
    sparkline: null,
  })),
  stocks: TOP_STOCK_SYMBOLS.map((d) => ({
    id: d.id,
    symbol: d.yahoo,
    label: d.label,
    name: d.name,
    price: null,
    changePercent: null,
    marketCap: null,
    unit: d.unit,
    ok: false,
    source: 'yahoo',
  })),
  etfs: TOP_ETF_SYMBOLS.map((d) => ({
    id: d.id,
    symbol: d.yahoo,
    label: d.label,
    name: d.name,
    price: null,
    changePercent: null,
    marketCap: null,
    unit: d.unit,
    ok: false,
    source: 'yahoo',
  })),
  indexes: INDEX_SYMBOLS.map((d) => ({
    id: d.id,
    symbol: d.yahoo,
    label: d.label,
    name: d.name,
    price: null,
    changePercent: null,
    unit: d.unit,
    ok: false,
    source: 'yahoo',
    sparkline: null,
  })),
  cryptos: CRYPTO_FALLBACK.map((c) => ({ ...c, stale: true })),
  equityKind: 'stocks',
  cryptoKind: 'all',
  cryptoListLimit: 10,
  equityListLimit: 10,
  bubbles: [],
  bubbleCategory: 'cryptos',
  bubbleTf: '24h',
  bubbleTfLabel: '24h',
  bubbleNote: '',
  bubbleLimitation: '',
  bubbleRateLimited: false,
  bubbleStatus: 'loading',
  trendingPumps: [],
  trendingDumps: [],
  trending: [],
  trendingPumpsTf: '24h',
  trendingDumpsTf: '24h',
  trendingPumpsNote: '',
  trendingDumpsNote: '',
  trendingNote: '',
  trendingStale: false,
  trendingRateLimited: false,
  trendingPumpsStatus: 'loading',
  trendingDumpsStatus: 'loading',
  trendingStatus: 'loading',
  panels: {
    left: { ...DEFAULT_PANELS.left, assets: [] },
    right: { ...DEFAULT_PANELS.right, assets: [] },
  },
  panelVolumeFallback: { left: false, right: false },
  headlines: [],
  headlineCategory: 'tradfi',
  headlineSlide: 0,
  headlinesNote: '',
  headlinesThin: false,
  headlinesStale: false,
  headlinesFeeds: [],
  headlinesStatus: 'loading',
  headlineAnim: 'idle',
  lastOkAt: null,
  lastAttemptAt: null,
  cryptoAsOf: null,
  yahooAsOf: null,
  headlinesAsOf: null,
  cryptoUnavailable: false,
  status: 'loading',
  sourcesNote: 'CoinGecko · Yahoo Finance (proxied)',
  halvingText: 'Halving in —',
};

const app = document.querySelector<HTMLDivElement>('#app')!;

const HALVING_HOURGLASS = `<svg class="halving-hourglass" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M3.5 1.5h9a.75.75 0 0 1 0 1.5H12v1.1c0 1.2-.55 2.3-1.5 3.05L9.2 8l1.3 1.35A3.9 3.9 0 0 1 12 12.4V13.5h.5a.75.75 0 0 1 0 1.5h-9a.75.75 0 0 1 0-1.5H4v-1.1c0-1.2.55-2.3 1.5-3.05L6.8 8 5.5 6.65A3.9 3.9 0 0 1 4 3.6V3H3.5a.75.75 0 0 1 0-1.5Zm2.1 2.5c.2.55.55 1.05 1.05 1.4L8 6.2l1.35-.8c.5-.35.85-.85 1.05-1.4H5.6Zm0 8h4.8c-.2-.55-.55-1.05-1.05-1.4L8 9.8l-1.35.8c-.5.35-.85.85-1.05 1.4Z"/></svg>`;

function formatHalvingCountdown(now = Date.now()): string {
  const ms = NEXT_HALVING_UTC - now;
  if (ms <= 0) return 'Halving passed / awaiting next';
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const minutes = totalMin % 60;
  return `Halving in ${days}d ${hours}h ${minutes}m`;
}

function priceText(q: MarketQuote): string {
  if (q.price == null) return '—';
  switch (q.unit) {
    case 'oil':
      return formatOil(q.price);
    case 'oz':
      return formatMetal(q.price);
    case 'index':
      return formatIndex(q.price);
    case 'yield':
      return `${q.price.toFixed(3)}%`;
    default:
      return formatMoney(q.price);
  }
}

function heroAccent(id: string): string {
  switch (id) {
    case 'btc':
      return `<span class="hero-motif" aria-hidden="true"><svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><text x="8" y="11.5" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor">₿</text></svg></span>`;
    case 'wti':
      return `<span class="hero-motif" aria-hidden="true"><svg viewBox="0 0 12 16" width="10" height="14"><path d="M6 1 C6 1 1 7 1 10.5 A5 5 0 0 0 11 10.5 C11 7 6 1 6 1Z" fill="currentColor" opacity="0.85"/></svg></span>`;
    case 'gold':
      return `<span class="hero-motif" aria-hidden="true"><svg viewBox="0 0 18 12" width="16" height="11"><rect x="1" y="3" width="16" height="7" rx="1" fill="currentColor" opacity="0.9"/><rect x="3" y="1" width="12" height="3" rx="0.5" fill="currentColor" opacity="0.55"/></svg></span>`;
    case 'silver':
      return `<span class="hero-motif" aria-hidden="true"><svg viewBox="0 0 16 16" width="13" height="13"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="3" fill="currentColor" opacity="0.45"/></svg></span>`;
    default:
      return '';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pctWithTf(changePercent: number | null | undefined, tf = '24h'): string {
  return `<span class="${pctClass(changePercent)}">${formatPct(changePercent)}</span><span class="tf" title="Percent change over ~${escapeHtml(tf)}">${escapeHtml(tf)}</span>`;
}

function tipAttrs(plain: string, html?: string): string {
  // Newlines must be encoded — raw \n is unreliable in HTML attributes
  const tip = `data-tip="${escapeHtml(plain).replace(/\n/g, '&#10;')}"`;
  if (!html) return tip;
  // HTML is already entity-safe for text nodes; only quote-escape for the attribute
  const htmlAttr = html.replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
  return `${tip} data-tip-html="${htmlAttr}"`;
}

function tipAttrsForAsset(
  id: string,
  opts?: { kind?: 'crypto' | 'stock' | 'index' | 'hero'; name?: string; symbol?: string },
): string {
  return tipAttrs(describeAsset(id, opts), describeAssetHtml(id, opts));
}

function heroArtClass(id: string): string {
  if (['btc', 'wti', 'gold', 'silver'].includes(id)) return `art-${id}`;
  if (id === 'spx' || id === 'ndx') return `art-${id}`;
  return '';
}

function sparkHtml(q: MarketQuote, opts?: { color?: string; index?: boolean }): string {
  const closes = q.sparkline;
  if (!closes || closes.length < 2) {
    return `<div class="spark-wrap spark-empty" aria-hidden="true"></div>`;
  }
  const color =
    opts?.color ??
    HERO_SPARK_COLORS[q.id] ??
    (opts?.index ? INDEX_SPARK_COLOR : '#3dd6c6');
  const svg = sparklineSvg(closes, { w: 140, h: 32, color });
  // Parent tile/row is the click target — avoid nested <a>
  return `<div class="spark-wrap" aria-hidden="true">${svg}</div>`;
}

function pencilSvg(): string {
  return `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M11.7 1.3a1.5 1.5 0 0 1 2.1 2.1L5.2 12l-2.7.6.6-2.7 8.6-8.6zM10.3 2.7 13.3 5.7"/></svg>`;
}

function tileHtml(
  q: MarketQuote,
  opts?: { hero?: boolean; spark?: boolean; heroSlot?: number; indexSlot?: number },
): string {
  const hero = opts?.hero ?? false;
  const showSpark = hero || opts?.spark === true;
  const broken = !q.ok && q.price == null;
  const artClass = hero ? heroArtClass(q.id) : '';
  const classes = [
    'tile',
    hero ? 'hero-tile' : '',
    artClass,
    q.stale ? 'stale' : '',
    broken ? 'broken' : '',
    'has-tip',
  ]
    .filter(Boolean)
    .join(' ');
  const badge =
    q.stale && q.price != null
      ? `<span class="badge">STALE</span>`
      : broken
        ? `<span class="badge">N/A</span>`
        : '';
  const motif = hero ? heroAccent(q.id) : '';
  const halvingInline =
    hero && q.id === 'btc'
      ? `<span class="halving-line">${escapeHtml(state.halvingText)}${HALVING_HOURGLASS}</span>`
      : '';
  const spark = showSpark ? sparkHtml(q, { index: !hero }) : '';
  const kind = hero ? 'hero' : q.id.startsWith('idx-') ? 'index' : 'stock';
  const tipOpts = {
    kind,
    name: q.name ?? q.label,
    symbol: q.symbol,
  } as const;
  const href = chartUrlFor(q.id, { kind, symbol: q.symbol, name: q.name ?? q.label });
  const anchor = `
    <a class="${classes} tile-link" data-id="${q.id}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" ${tipAttrsForAsset(q.id, tipOpts)} aria-label="Open chart for ${escapeHtml(q.label)}">
      <div class="lbl">${motif}<span class="lbl-text">${escapeHtml(q.label)}</span>${halvingInline}</div>
      <div class="price">${priceText(q)}</div>
      <div class="pct-row">${pctWithTf(q.changePercent)} ${badge}</div>
      ${spark}
    </a>
  `;
  const indexSlot = opts?.indexSlot;
  const editable =
    state.user &&
    (hero || (typeof indexSlot === 'number' && Number.isFinite(indexSlot)));
  if (!editable) {
    // Indexes/hero without edit: still wrap hero for layout height; indexes stay bare for guests
    if (hero) return `<div class="tile-wrap">${anchor}</div>`;
    return anchor;
  }
  if (hero) {
    const slot = opts?.heroSlot ?? 0;
    const editBtn = `<button type="button" class="tile-edit" data-edit-section="hero" data-edit-slot="${slot}" aria-label="Change hero asset" title="Change asset">${pencilSvg()}</button>`;
    return `<div class="tile-wrap editable">${anchor}${editBtn}</div>`;
  }
  const slot = indexSlot ?? 0;
  const editBtn = `<button type="button" class="tile-edit" data-edit-section="indexes" data-edit-slot="${slot}" aria-label="Change index asset" title="Change asset">${pencilSvg()}</button>`;
  return `<div class="tile-wrap editable">${anchor}${editBtn}</div>`;
}

function cryptoLogoHtml(r: { image?: string | null }): string {
  if (r.image) {
    return `<img class="coin-logo" src="${escapeHtml(r.image)}" alt="" width="16" height="16" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='inline-block')" /><span class="coin-ph" style="display:none" aria-hidden="true"></span>`;
  }
  return `<span class="coin-ph" aria-hidden="true"></span>`;
}

function stockLogoHtml(yahooTicker: string): string {
  const url = stockLogoUrl(yahooTicker);
  return `<img class="coin-logo stock-logo" src="${escapeHtml(url)}" alt="" width="16" height="16" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='inline-block')" /><span class="coin-ph" style="display:none" aria-hidden="true"></span>`;
}


function sortByMktCapDesc<T extends { marketCap?: number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const am = a.marketCap;
    const bm = b.marketCap;
    if (am == null && bm == null) return 0;
    if (am == null) return 1;
    if (bm == null) return -1;
    return bm - am;
  });
}

/** Crypto rows for the table: All Crypto or L1s, capped, re-ranked. */
function displayedCryptos(): CryptoRow[] {
  const base =
    state.cryptoKind === 'l1s' ? filterL1Cryptos(state.cryptos) : state.cryptos;
  return base.slice(0, state.cryptoListLimit).map((r, i) => ({ ...r, rank: i + 1 }));
}

function displayedEquities(): MarketQuote[] {
  const rows = state.equityKind === 'etfs' ? state.etfs : state.stocks;
  return sortByMktCapDesc(rows).slice(0, state.equityListLimit);
}

function cryptoSectionLabel(): string {
  const n = state.cryptoListLimit;
  let src: string;
  if (state.cryptoUnavailable || state.cryptos.some((c) => c.fallback)) {
    src = '· CoinGecko unavailable';
  } else if (state.cryptos.some((c) => c.stale)) {
    src = '· cached (stale)';
  } else if (state.cryptos.some((c) => c.ok)) {
    src = '· CoinGecko';
  } else if (state.status === 'loading') {
    src = '· loading';
  } else {
    src = '· CoinGecko unavailable';
  }
  if (state.cryptoKind === 'l1s') {
    return `Top ${n} L1s by Mkt Cap ${src}`.trim();
  }
  return `Top ${n} Crypto Assets by Mkt Cap ${src}`.trim();
}

function cryptoRowsHtml(rows: CryptoRow[]): string {
  if (!rows.length) {
    const msg =
      state.status === 'loading'
        ? 'Loading crypto quotes…'
        : state.cryptoUnavailable
          ? 'CoinGecko unavailable — no live crypto quotes right now.'
          : 'No crypto rows to show.';
    return `<tr class="table-empty"><td colspan="6">${escapeHtml(msg)}</td></tr>`;
  }
  return rows
    .map((r) => {
      const tipOpts = { kind: 'crypto' as const, name: r.name, symbol: r.symbol };
      const href = chartUrlFor(r.id, tipOpts);
      return `
    <tr class="has-tip row-link ${r.stale ? 'stale' : ''} ${r.fallback ? 'fallback' : ''}" data-href="${escapeHtml(href)}" tabindex="0" role="link" ${tipAttrsForAsset(r.id, tipOpts)}>
      <td class="rank">${r.rank}</td>
      <td class="asset">
        ${cryptoLogoHtml(r)}
        <span class="ticker">${escapeHtml(r.symbol)}</span>
      </td>
      <td class="name">${escapeHtml(r.name)}</td>
      <td class="num price-cell">${formatMoney(r.price)}</td>
      <td class="num pct-cell">${pctWithTf(r.changePercent)}</td>
      <td class="num mcap">${formatMktCap(r.marketCap)}</td>
    </tr>`;
    })
    .join('');
}

function stockRowsHtml(rows: MarketQuote[]): string {
  if (!rows.length) {
    const msg =
      state.status === 'loading'
        ? 'Loading equity quotes…'
        : 'Yahoo quotes unavailable — no rows to show.';
    return `<tr class="table-empty"><td colspan="6">${escapeHtml(msg)}</td></tr>`;
  }
  const allBroken = rows.every((r) => !r.ok && r.price == null);
  if (allBroken) {
    const msg =
      state.status === 'loading'
        ? 'Loading equity quotes…'
        : 'Yahoo unavailable — equity quotes failed. Last good values kept only when marked stale on individual rows after a partial refresh.';
    return `<tr class="table-empty"><td colspan="6">${msg}</td></tr>`;
  }
  const chartKind = state.equityKind === 'etfs' ? ('etf' as const) : ('stock' as const);
  return rows
    .map((r, i) => {
      const broken = !r.ok && r.price == null;
      const tipOpts = { kind: 'stock' as const, name: r.name, symbol: r.symbol };
      const href = chartUrlFor(r.id, { kind: chartKind, name: r.name, symbol: r.symbol });
      return `
    <tr class="has-tip row-link ${r.stale ? 'stale' : ''} ${broken ? 'broken' : ''}" data-href="${escapeHtml(href)}" tabindex="0" role="link" ${tipAttrsForAsset(r.id, tipOpts)}>
      <td class="rank">${i + 1}</td>
      <td class="asset">
        ${stockLogoHtml(r.symbol)}
        <span class="ticker">${escapeHtml(r.label)}</span>
      </td>
      <td class="name">${escapeHtml(r.name ?? r.label)}</td>
      <td class="num price-cell">${formatMoney(r.price)}</td>
      <td class="num pct-cell">${pctWithTf(r.changePercent)}</td>
      <td class="num mcap">${formatMktCap(r.marketCap ?? null)}</td>
    </tr>`;
    })
    .join('');
}


function shortAsOf(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function moduleMetaHtml(source: string, asOf: Date | null, extra = ''): string {
  const staleNote = extra ? ` · ${escapeHtml(extra)}` : '';
  return `<div class="module-meta"><span>Source: ${escapeHtml(source)}</span><span>As of: ${escapeHtml(shortAsOf(asOf))}</span>${staleNote}</div>`;
}

function marketHoursStripHtml(): string {
  const h = nyseHoursEstimate();
  const cls = h.open ? 'hours-open' : 'hours-closed';
  return `<div class="hours-strip ${cls}" role="status" aria-label="US equity market hours estimate">
    <span class="hours-badge">${escapeHtml(h.status)}</span>
    <span class="hours-ny">${escapeHtml(h.nyTime)}</span>
    <span class="hours-detail">${escapeHtml(h.detail)}</span>
  </div>`;
}

function setShareQuery(yahoo: string | null): void {
  try {
    const url = new URL(window.location.href);
    if (yahoo) url.searchParams.set('q', yahoo);
    else url.searchParams.delete('q');
    // Drop leftover /quote/ path if present
    if (url.pathname.startsWith('/quote/')) url.pathname = '/';
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    /* ignore */
  }
}

function readInitialQuery(): string {
  try {
    const url = new URL(window.location.href);
    const q = (url.searchParams.get('q') ?? '').trim();
    if (q) return q;
    const m = url.pathname.match(/^\/quote\/([^/]+)\/?$/i);
    if (m?.[1]) return decodeURIComponent(m[1]).trim();
  } catch {
    /* ignore */
  }
  return '';
}

function watchlistBarHtml(): string {
  if (!watchlist.length) {
    return `<div class="watchlist-bar watchlist-empty" aria-label="Watchlist">
      <span class="watchlist-lbl">Watchlist</span>
      <span class="watchlist-hint">Local only · star a symbol from search</span>
    </div>`;
  }
  const chips = watchlist
    .map((w) => {
      const q = watchQuotes.get(w.yahoo.toUpperCase());
      const price = q ? priceText(q) : '…';
      const pct = q ? pctWithTf(q.changePercent) : '';
      const stale = q?.stale ? ' stale' : '';
      const broken = q && !q.ok && q.price == null ? ' broken' : '';
      return `<button type="button" class="watch-chip${stale}${broken}" data-watch-focus="${escapeHtml(w.yahoo)}" title="${escapeHtml(w.name ?? w.label)}">
        <span class="watch-sym">${escapeHtml(w.label)}</span>
        <span class="watch-px">${escapeHtml(price)}</span>
        <span class="watch-pct">${pct}</span>
        <span class="watch-x" data-watch-remove="${escapeHtml(w.yahoo)}" title="Remove" aria-label="Remove ${escapeHtml(w.label)}">×</span>
      </button>`;
    })
    .join('');
  return `<div class="watchlist-bar" aria-label="Watchlist">
    <span class="watchlist-lbl">Watchlist</span>
    <button type="button" class="tf-btn watch-clear" data-watch-clear aria-label="Clear watchlist">Clear</button>
    <div class="watch-chips">${chips}</div>
    ${moduleMetaHtml('Yahoo (proxied)', state.yahooAsOf, 'localStorage only')}
  </div>`;
}

function dashSearchHtml(): string {
  const q = dashSearch.query;
  const onWatch =
    dashSearch.focusedYahoo != null &&
    isOnWatchlist(watchlist, dashSearch.focusedYahoo);
  let results = '';
  if (dashSearch.open && (dashSearch.loading || dashSearch.results.length || q.trim())) {
    if (dashSearch.loading) {
      results = `<div class="dash-search-results" role="listbox"><div class="dash-search-empty">Searching…</div></div>`;
    } else if (!dashSearch.results.length) {
      results = `<div class="dash-search-results" role="listbox"><div class="dash-search-empty">No matches</div></div>`;
    } else {
      results = `<div class="dash-search-results" role="listbox">${dashSearch.results
        .slice(0, 12)
        .map((a) => {
          const starred = isOnWatchlist(watchlist, a.yahoo) ? '★' : '☆';
          return `<div class="dash-search-row" role="option">
            <button type="button" class="dash-search-pick" data-dash-pick="${escapeHtml(a.yahoo)}">${escapeHtml(a.label)} <span class="dash-search-name">${escapeHtml(a.name ?? '')}</span></button>
            <button type="button" class="dash-search-star" data-dash-star="${escapeHtml(a.yahoo)}" data-dash-label="${escapeHtml(a.label)}" data-dash-id="${escapeHtml(a.id)}" data-dash-name="${escapeHtml(a.name ?? '')}" aria-label="Toggle watchlist">${starred}</button>
          </div>`;
        })
        .join('')}</div>`;
    }
  }

  let focusCard = '';
  if (dashSearch.focusedYahoo) {
    const y = dashSearch.focusedYahoo.toUpperCase();
    const qte = watchQuotes.get(y);
    const def =
      dashSearch.results.find((a) => a.yahoo.toUpperCase() === y) ||
      watchlist.find((w) => w.yahoo.toUpperCase() === y);
    const label = def?.label ?? dashSearch.focusedYahoo;
    const name = (def && 'name' in def ? def.name : '') || '';
    let body: string;
    if (dashSearch.focusedStatus === 'loading' && !qte) {
      body = `<div class="focus-quote-body">Loading quote…</div>`;
    } else if (!qte || (qte.price == null && !qte.stale)) {
      body = `<div class="focus-quote-body focus-err">Yahoo unavailable for ${escapeHtml(label)}. Try again shortly.</div>`;
    } else {
      const badge =
        qte.stale && qte.price != null
          ? `<span class="badge">STALE</span>`
          : !qte.ok && qte.price == null
            ? `<span class="badge">N/A</span>`
            : '';
      body = `<div class="focus-quote-body">
        <div class="focus-price">${escapeHtml(priceText(qte))} ${badge}</div>
        <div class="focus-pct">${pctWithTf(qte.changePercent)}</div>
      </div>`;
    }
    const share = `/?q=${encodeURIComponent(dashSearch.focusedYahoo)}`;
    focusCard = `<div class="focus-quote ${qte?.stale ? 'stale' : ''}" aria-label="Focused quote">
      <div class="focus-head">
        <div>
          <div class="focus-sym">${escapeHtml(label)}</div>
          ${name ? `<div class="focus-name">${escapeHtml(name)}</div>` : ''}
        </div>
        <div class="focus-actions">
          <button type="button" class="tf-btn" data-dash-star="${escapeHtml(dashSearch.focusedYahoo)}" data-dash-label="${escapeHtml(label)}" data-dash-id="${escapeHtml((def && 'id' in def ? def.id : label) || label)}" data-dash-name="${escapeHtml(name)}" aria-label="Toggle watchlist">${onWatch ? '★ Watchlist' : '☆ Watchlist'}</button>
          <a class="tf-btn focus-share" href="${escapeHtml(share)}">Share</a>
          <button type="button" class="tf-btn" data-dash-clear>Clear</button>
        </div>
      </div>
      ${body}
      ${moduleMetaHtml('Yahoo (proxied)', state.yahooAsOf, dashSearch.note)}
    </div>`;
  }

  return `<div class="dash-search-wrap">
    <label class="dash-search-label" for="dash-search-input">Search ticker or coin</label>
    <div class="dash-search-row-main">
      <input id="dash-search-input" class="dash-search-input" type="search" placeholder="e.g. AAPL, BTC-USD, QQQ" value="${escapeHtml(q)}" autocomplete="off" spellcheck="false" aria-label="Search ticker or coin" />
      <button type="button" class="tf-btn dash-search-go" data-dash-go>Check</button>
    </div>
    ${results}
    ${focusCard}
  </div>`;
}

function dashChromeHtml(): string {
  return `<div class="dash-chrome">
    ${marketHoursStripHtml()}
    ${dashSearchHtml()}
    ${watchlistBarHtml()}
  </div>`;
}

function formatTimes(d: Date | null): { local: string; utc: string } {
  if (!d) return { local: '—', utc: '—' };
  const local = d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const utc = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  return { local, utc };
}

function catSelected(c: BubbleCategory): string {
  return state.bubbleCategory === c ? 'selected' : '';
}

function tfSelected(t: Timeframe): string {
  return state.bubbleTf === t ? 'selected' : '';
}

/** Bubble SVG viewBox width; height follows canvas aspect (matched to trending). */
const BUBBLE_W = 1200;

const CRYPTO_TFS: Timeframe[] = ['1h', '24h', '7d', '30d', '1y'];
const EQUITY_TFS: Timeframe[] = ['1h', '4h', '8h', '12h', '24h', '7d', '30d', '1y'];

function bubbleEmptyMessage(): string {
  if (state.bubbleStatus === 'loading') return 'Loading bubble movers…';
  const lim = `${state.bubbleLimitation} ${state.bubbleNote}`.toLowerCase();
  if (
    state.bubbleRateLimited ||
    lim.includes('429') ||
    lim.includes('rate-limit') ||
    lim.includes('rate limited')
  ) {
    return 'Upstream rate-limited (HTTP 429). Crypto bubbles prefer Binance (no key); CoinGecko is fallback only. Try Stocks/ETFs, or wait 1–2 minutes.';
  }
  if (state.bubbleLimitation) {
    return state.bubbleLimitation;
  }
  return 'No movers for this category / timeframe (data unavailable). Try another category or timeframe.';
}

function bubbleControlsHtml(): string {
  const cats: { id: BubbleCategory; label: string }[] = [
    { id: 'cryptos', label: 'All Crypto' },
    { id: 'solana', label: 'Solana' },
    { id: 'stocks', label: 'Stocks' },
    { id: 'etfs', label: 'ETFs' },
  ];
  const tfs: Timeframe[] =
    state.bubbleCategory === 'cryptos' || state.bubbleCategory === 'solana'
      ? CRYPTO_TFS
      : EQUITY_TFS;
  return `
    <div class="bubble-controls">
      <label class="ctrl">
        <span class="ctrl-lbl">Category</span>
        <select id="bubble-cat" aria-label="Bubble map category">
          ${cats.map((c) => `<option value="${c.id}" ${catSelected(c.id)}>${c.label}</option>`).join('')}
        </select>
      </label>
      <div class="tf-group" role="group" aria-label="Timeframe">
        ${tfs
          .map(
            (t) =>
              `<button type="button" class="tf-btn ${tfSelected(t)}" data-tf="${t}">${t}</button>`,
          )
          .join('')}
      </div>
      <span class="bubble-meta">
        Showing <strong>${escapeHtml(state.bubbleTfLabel)}</strong>
        · ${state.bubbleStatus === 'loading' ? 'Loading…' : state.bubbleStatus === 'stale' ? 'Stale' : state.bubbles.length ? `${state.bubbles.length} bubbles` : 'No data'}
      </span>
    </div>
    ${
      state.bubbleNote || state.bubbleLimitation
        ? `<div class="bubble-note">${escapeHtml(state.bubbleNote || state.bubbleLimitation)}</div>`
        : ''
    }
  `;
}

const TRENDING_TFS: TrendingTf[] = ['1h', '4h', '8h', '12h', '24h', '7d', '30d', '1y'];

function chartKindForPanelItem(item: TrendingItem): 'crypto' | 'stock' | 'index' | 'hero' | 'etf' {
  if (item.chartKind) return item.chartKind;
  const y = (item.yahoo || item.symbol || '').toUpperCase();
  if (item.id.startsWith('binance:') || item.id.startsWith('solana:') || /-USD$/i.test(y)) return 'crypto';
  if (y.startsWith('^') || item.id.startsWith('idx-')) return 'index';
  if (/=F$/i.test(y)) return 'hero';
  return 'stock';
}

function panelChgLabel(cfg: PanelConfig): string {
  if (cfg.mode === 'movers_up' || cfg.mode === 'movers_down') return `${cfg.tf} Chg`;
  if (cfg.sort === 'mcap') return 'Mkt Cap';
  if (cfg.sort === 'volume_24h' || cfg.sort === 'volume_7d' || cfg.sort === 'volume_30d') {
    const tag =
      cfg.sort === 'volume_7d' ? '7d Vol' : cfg.sort === 'volume_30d' ? '30d Vol' : '24h Vol';
    return tag;
  }
  return '24h Chg';
}

function trendRowMetricHtml(item: TrendingItem, cfg: PanelConfig): string {
  if (cfg.mode === 'movers_up' || cfg.mode === 'movers_down' || cfg.sort === 'change') {
    return `<div class="trend-chg ${pctClass(item.changePercent)}">${formatPct(item.changePercent)}</div>`;
  }
  if (cfg.sort === 'mcap') {
    return `<div class="trend-chg">${formatMktCap(item.marketCap ?? null)}</div>`;
  }
  // volume sorts — show volume, with % as secondary via title
  const vol = item.volume ?? null;
  return `<div class="trend-chg" title="${escapeHtml(formatPct(item.changePercent))}">${formatMktCap(vol)}</div>`;
}

function trendingListHtml(
  items: TrendingItem[],
  empty: string,
  cfg: PanelConfig,
): string {
  const rows = items.length
    ? items
        .map((item) => {
          // Rebuild row with metric column adapted to sort
          const kind = chartKindForPanelItem(item);
          const tipOpts = {
            kind: kind === 'etf' ? ('stock' as const) : kind === 'hero' ? ('hero' as const) : kind,
            name: item.name,
            symbol: item.symbol,
          };
          const href = chartUrlFor(item.id, {
            kind,
            name: item.name,
            symbol: item.yahoo || item.symbol,
          });
          const isCrypto = kind === 'crypto';
          const img = isCrypto
            ? item.image ||
              `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/color/${encodeURIComponent(item.symbol.toLowerCase())}.png`
            : item.image || stockLogoUrl(item.yahoo || item.symbol);
          const logo = `<img class="trend-logo" src="${escapeHtml(img)}" alt="" width="22" height="22" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='inline-flex')" /><span class="trend-logo-ph" style="display:none" aria-hidden="true">${escapeHtml((item.symbol || '?').slice(0, 1))}</span>`;
          return `
        <a class="trend-row has-tip row-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" ${tipAttrsForAsset(item.id, tipOpts)} aria-label="Open ${escapeHtml(item.symbol)} chart">
          <div class="trend-token">
            ${logo}
            <span class="trend-sym">${escapeHtml(item.symbol)}</span>
          </div>
          <div class="trend-price">${formatMoney(item.price ?? null)}</div>
          ${trendRowMetricHtml(item, cfg)}
        </a>`;
        })
        .join('')
    : `<div class="trend-empty">${empty}</div>`;
  const scrollClass = cfg.size === 25 ? ' is-scrollable' : '';
  return `
      <div class="trend-head">
        <span>Asset</span><span class="num">Price</span><span class="num">${escapeHtml(panelChgLabel(cfg))}</span>
      </div>
      <div class="trend-grid${scrollClass}">${rows}</div>`;
}

function trendingTfBarHtml(side: 'left' | 'right'): string {
  const cfg = state.panels[side];
  if (!panelShowsTfBar(cfg)) return '';
  const selected = cfg.tf;
  const attr = side === 'left' ? 'data-panel-tf-left' : 'data-panel-tf-right';
  // Keep legacy attrs so old handlers still work during transition
  const legacy = side === 'left' ? 'data-pumps-tf' : 'data-dumps-tf';
  return `
    <div class="trend-tf-bar trending-controls" role="group" aria-label="${escapeHtml(cfg.title)} timeframe">
      <div class="tf-group">
        ${TRENDING_TFS.map(
          (tf) =>
            `<button type="button" class="tf-btn ${selected === tf ? 'selected' : ''}" ${attr}="${tf}" ${legacy}="${tf}">${tf}</button>`,
        ).join('')}
      </div>
    </div>`;
}

function panelEditPopHtml(side: 'left' | 'right'): string {
  if (!panelEdit || panelEdit.side !== side) return '';
  const draft = panelEdit.draft;
  const modeOpts: { id: PanelMode; label: string }[] = [
    { id: 'movers_up', label: 'Top movers up' },
    { id: 'movers_down', label: 'Top movers down' },
    { id: 'curated', label: 'Curated list' },
    { id: 'filter_crypto', label: 'Crypto (universe)' },
    { id: 'filter_stocks', label: 'Stocks (universe)' },
    { id: 'filter_metals', label: 'Metals' },
  ];
  const sortOpts: { id: PanelSort; label: string }[] = [
    { id: 'change', label: 'Change %' },
    { id: 'mcap', label: 'Market cap' },
    { id: 'volume_24h', label: 'Volume 24h' },
    { id: 'volume_7d', label: 'Volume 7d' },
    { id: 'volume_30d', label: 'Volume 30d' },
  ];
  const list = panelEdit.loading
    ? `<div class="hero-edit-empty">Searching…</div>`
    : panelEdit.assets.length
      ? `<ul class="hero-edit-list panel-edit-asset-list" role="listbox">${panelEdit.assets
          .map((a) => {
            const picked = draft.assets.some((x) => x.yahoo.toUpperCase() === a.yahoo.toUpperCase());
            return `<li role="option"><button type="button" class="hero-edit-item ${picked ? 'is-picked' : ''}" data-panel-pick="${escapeHtml(a.yahoo)}" title="${escapeHtml(a.yahoo)}"><span class="hero-edit-label">${escapeHtml(a.label)}</span><span class="hero-edit-meta">${picked ? '✓ ' : ''}${escapeHtml(a.name ?? a.yahoo)}</span></button></li>`;
          })
          .join('')}</ul>`
      : `<div class="hero-edit-empty">No matches</div>`;
  const curatedBlock =
    draft.mode === 'curated'
      ? `<div class="panel-edit-curated">
          <div class="panel-edit-curated-label">Selected (${draft.assets.length})</div>
          <div class="panel-edit-chips">
            ${
              draft.assets.length
                ? draft.assets
                    .map(
                      (a) =>
                        `<button type="button" class="panel-chip" data-panel-remove="${escapeHtml(a.yahoo)}" title="Remove">${escapeHtml(a.label)} ×</button>`,
                    )
                    .join('')
                : `<span class="panel-edit-hint">Search &amp; add assets below</span>`
            }
          </div>
          <input class="hero-edit-search panel-edit-search" type="search" placeholder="Search assets…" value="${escapeHtml(panelEdit.query)}" autocomplete="off" aria-label="Search assets" data-panel-search="${side}" />
          ${list}
        </div>`
      : '';
  const err = panelEdit.error
    ? `<div class="hero-edit-err">${escapeHtml(panelEdit.error)}</div>`
    : '';
  const volNote =
    draft.sort === 'volume_7d' || draft.sort === 'volume_30d'
      ? `<div class="panel-edit-hint">7d/30d volume uses 24h when longer windows aren’t available.</div>`
      : '';
  return `<div class="hero-edit-pop panel-edit-pop" role="dialog" aria-label="Edit panel" data-panel-edit-side="${side}">
    <div class="hero-edit-head">Edit panel</div>
    <label class="panel-edit-field">
      <span>Title</span>
      <input type="text" class="panel-edit-title" maxlength="48" value="${escapeHtml(draft.title)}" data-panel-field="title" data-panel-side="${side}" />
    </label>
    <label class="panel-edit-field">
      <span>Mode</span>
      <select class="panel-edit-select" data-panel-field="mode" data-panel-side="${side}">
        ${modeOpts.map((o) => `<option value="${o.id}" ${draft.mode === o.id ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
      </select>
    </label>
    <div class="panel-edit-row">
      <label class="panel-edit-field">
        <span>Size</span>
        <select class="panel-edit-select" data-panel-field="size" data-panel-side="${side}">
          <option value="10" ${draft.size === 10 ? 'selected' : ''}>Top 10</option>
          <option value="25" ${draft.size === 25 ? 'selected' : ''}>Top 25</option>
        </select>
      </label>
      <label class="panel-edit-field">
        <span>Sort</span>
        <select class="panel-edit-select" data-panel-field="sort" data-panel-side="${side}">
          ${sortOpts.map((o) => `<option value="${o.id}" ${draft.sort === o.id ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
        </select>
      </label>
    </div>
    ${volNote}
    ${curatedBlock}
    ${err}
    <div class="panel-edit-actions">
      <button type="button" class="auth-btn" data-panel-cancel="${side}">Cancel</button>
      <button type="button" class="auth-btn panel-edit-save" data-panel-save="${side}">Save</button>
    </div>
  </div>`;
}

function trendingPanelHtml(side: 'left' | 'right'): string {
  const cfg = state.panels[side];
  const items = side === 'left' ? state.trendingPumps : state.trendingDumps;
  const status = side === 'left' ? state.trendingPumpsStatus : state.trendingDumpsStatus;
  const note = side === 'left' ? state.trendingPumpsNote : state.trendingDumpsNote;
  const loading = status === 'loading';
  const volFb = state.panelVolumeFallback[side]
    ? ' Volume window fell back to 24h.'
    : '';
  const emptyMsg = loading
    ? 'Loading…'
    : escapeHtml((note || state.trendingNote || 'No assets for this panel.') + volFb);
  const editBtn = state.user
    ? `<button type="button" class="tile-edit panel-edit-btn" data-panel-edit="${side}" aria-label="Edit panel" title="Edit panel">${pencilSvg()}</button>`
    : '';
  const kindClass =
    cfg.mode === 'movers_up' ? 'pumps' : cfg.mode === 'movers_down' ? 'dumps' : 'custom';
  return `
    <section aria-label="${escapeHtml(cfg.title)}" class="trend-panel trend-panel-${kindClass}" data-panel-side="${side}">
      <div class="trend-panel-header">
        <div class="section-label trend-panel-title">${escapeHtml(cfg.title)}</div>
        ${trendingTfBarHtml(side)}
        ${editBtn}
      </div>
      ${trendingListHtml(items, emptyMsg, cfg)}
      ${panelEditPopHtml(side)}
    </section>`;
}

function relativeTime(iso: string | null, ms: number | null): string {
  const t = ms ?? (iso ? Date.parse(iso) : NaN);
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 0) return 'just now';
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

const HEADLINE_CAT_ICONS: Record<HeadlineCategory, string> = {
  tradfi: '<svg class="hl-tab-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M1 13h14v1H1zm2-1V7h2v5H3zm4 0V4h2v8H7zm4 0V9h2v3h-2z"/></svg>',
  crypto: '<svg class="hl-tab-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path fill="currentColor" d="M8.7 4.2h-.9v1.1H6.6v1h1.2v.9H6.6v1h1.2V10h.9V9.2h.5c1.1 0 1.9-.7 1.9-1.65 0-.7-.4-1.2-1-1.4.4-.25.7-.7.7-1.25 0-.95-.8-1.7-1.9-1.7H8.7zm.4 4.55h-.4v-1h.45c.45 0 .75.25.75.55s-.3.45-.8.45zm-.05-2.55h-.35v-.9h.4c.4 0 .7.2.7.5s-.3.4-.75.4z"/></svg>',
  politics: '<svg class="hl-tab-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 1.5 1.5 5v1.2h13V5L8 1.5zM3 7v5H2v1.5h12V12h-1V7H3zm1.2 5V7h1.5v5H4.2zm3.1 0V7h1.4v5H7.3zm3.1 0V7H12v5h-1.5z"/></svg>',
  housing: '<svg class="hl-tab-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 2.2 2 7.2V14h4.2v-4h3.6v4H14V7.2L8 2.2z"/></svg>',
  web3nfts: '<svg class="hl-tab-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" d="M8 1.8 13.2 4.8v6.4L8 14.2 2.8 11.2V4.8z"/></svg>',
  health: '<svg class="hl-tab-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 13.6S2.5 10.2 2.5 6.4C2.5 4.5 3.9 3 5.7 3c1.1 0 2.1.6 2.3 1.5C8.2 3.6 9.2 3 10.3 3c1.8 0 3.2 1.5 3.2 3.4 0 3.8-5.5 7.2-5.5 7.2z"/></svg>',
  longevity: '<svg class="hl-tab-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" d="M5 2.5h6M5 13.5h6M6.2 2.5c0 2.2 1.8 3.3 1.8 5.5S6.2 11.3 6.2 13.5M9.8 2.5c0 2.2-1.8 3.3-1.8 5.5s1.8 3.3 1.8 5.5"/></svg>',
  technology: '<svg class="hl-tab-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M5 5h6v6H5zm-2 .8h1.2v1.2H3zm0 2.4h1.2v1.2H3zM11.8 5.8H13v1.2h-1.2zm0 2.4H13v1.2h-1.2zM6.8 3H8v1.2H6.8zm2.4 0H10v1.2H9.2zM6.8 11.8H8V13H6.8zm2.4 0H10V13H9.2z"/></svg>',
  ai: '<svg class="hl-tab-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 1.5 8.9 6H13l-3.3 2.4L10.8 14 8 11.4 5.2 14l1.1-5.6L3 6h4.1z"/></svg>',
  robotics: '<svg class="hl-tab-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7.3 1.5h1.4v1.4H7.3zM3.5 4.2h9v8.3h-9zm2 2.2v1.6h1.6V6.4zm3.4 0v1.6H10.5V6.4zM5.5 10h5v1.2h-5zM2 6.5h1.2v3H2zm10.8 0H14v3h-1.2z"/></svg>',
  podcasts: '<svg class="hl-tab-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 1.8A3.2 3.2 0 0 0 4.8 5v2.2a3.2 3.2 0 0 0 6.4 0V5A3.2 3.2 0 0 0 8 1.8zm-1.1 8.7v1.3H5.2V13h5.6v-1.2H9.1v-1.3c.9-.2 1.7-.7 2.2-1.4l-.9-.7c-.4.6-1.1 1-1.9 1-.8 0-1.5-.4-1.9-1l-.9.7c.5.7 1.3 1.2 2.2 1.4z"/></svg>',
};

const HEADLINE_CATS: { id: HeadlineCategory; label: string }[] = [
  { id: 'tradfi', label: 'Traditional Finance' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'podcasts', label: 'Podcasts' },
  { id: 'politics', label: 'Finance in Politics' },
  { id: 'housing', label: 'US Housing Market' },
  { id: 'web3nfts', label: 'Web3 IPs & NFTs' },
  { id: 'health', label: 'Health' },
  { id: 'longevity', label: 'Longevity' },
  { id: 'technology', label: 'Technology' },
  { id: 'ai', label: 'AI' },
  { id: 'robotics', label: 'Robotics' },
];

const HEADLINE_VISIBLE = 4;

/** Prefetch cache so category switches feel instant. */
const headlinesPrefetch = new Map<HeadlineCategory, Awaited<ReturnType<typeof fetchHeadlines>>>();
let headlineSwitchToken = 0;

type MagicUi = {
  email: string;
  code: string;
  phase: 'idle' | 'sent' | 'sending' | 'verifying';
  note: string;
};

let loginMenuOpen = false;
const AUTH_HIDE_KEY = 'mc_hide_auth_identity';
let hideAuthIdentity = (() => {
  try {
    return localStorage.getItem(AUTH_HIDE_KEY) === '1';
  } catch {
    return false;
  }
})();

/** Guest watchlist — localStorage only (no account). */
let watchlist: WatchItem[] = loadWatchlist();
/** Quotes for watchlist + focused search symbol (Yahoo). */
const watchQuotes = new Map<string, MarketQuote>();

type DashSearchState = {
  query: string;
  results: HeroAssetDef[];
  loading: boolean;
  open: boolean;
  /** Selected / URL-shared symbol */
  focusedYahoo: string | null;
  focusedStatus: 'idle' | 'loading' | 'ok' | 'err';
  note: string;
};
let dashSearch: DashSearchState = {
  query: '',
  results: [],
  loading: false,
  open: false,
  focusedYahoo: null,
  focusedStatus: 'idle',
  note: '',
};
let dashSearchTimer: ReturnType<typeof setTimeout> | null = null;
let dashSearchAbort: AbortController | null = null;

const magicUi: MagicUi = {
  email: '',
  code: '',
  phase: 'idle',
  note: '',
};

/** Top marquee items (mixed categories); populated async after first paint. */
let tickerItems: HeadlineItem[] = [];
let tickerStatus: 'loading' | 'ok' | 'empty' = 'loading';
const TICKER_CATS: HeadlineCategory[] = [
  'tradfi',
  'crypto',
  'podcasts',
  'politics',
  'technology',
  'ai',
];

const YT_THUMB_ORDER = ['hq720', 'hqdefault', 'sddefault', 'mqdefault'] as const;

function ytIdFromUrl(url: string): string | null {
  const m = url.match(/\/vi\/([A-Za-z0-9_-]+)\//i);
  return m?.[1] ?? null;
}

function advanceYtThumb(img: HTMLImageElement): boolean {
  const src = img.currentSrc || img.src || '';
  const id = ytIdFromUrl(src);
  if (!id) return false;
  const cur = src.match(/\/(hq720|maxresdefault|hqdefault|sddefault|mqdefault|default)\.jpg/i)?.[1]?.toLowerCase();
  let idx = YT_THUMB_ORDER.indexOf((cur === 'maxresdefault' || cur === 'default' ? 'hq720' : cur) as (typeof YT_THUMB_ORDER)[number]);
  if (idx < 0) idx = Number(img.dataset.ytStep || '0');
  const next = YT_THUMB_ORDER[idx + 1];
  if (!next) return false;
  img.dataset.ytStep = String(idx + 1);
  img.src = `https://i.ytimg.com/vi/${id}/${next}.jpg`;
  return true;
}

/** Inline handlers — try alternate YT thumbs before dropping the card. */
(window as unknown as { __hlImgFail?: (img: HTMLImageElement) => void }).__hlImgFail = (img) => {
  if (/i\.ytimg\.com/i.test(img.currentSrc || img.src || '') && advanceYtThumb(img)) return;
  img.closest('.hl-card')?.remove();
};
(window as unknown as { __hlImgCheck?: (img: HTMLImageElement) => void }).__hlImgCheck = (img) => {
  // YouTube missing maxres/hq720 can 200 a gray ~120×90 placeholder
  if (
    /i\.ytimg\.com/i.test(img.currentSrc || img.src || '') &&
    img.naturalWidth > 0 &&
    img.naturalWidth <= 160
  ) {
    if (advanceYtThumb(img)) return;
    img.closest('.hl-card')?.remove();
  }
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
  );
}

function headlineImageHtml(h: HeadlineItem): string {
  if (!h.image) return '';
  return `<div class="hl-img-wrap"><img class="hl-img" src="${escapeHtml(h.image)}" alt="" loading="lazy" decoding="async" onerror="window.__hlImgFail&&window.__hlImgFail(this)" onload="window.__hlImgCheck&&window.__hlImgCheck(this)" /></div>`;
}

function headlinesHtml(): string {
  const n = state.headlines.length;
  const status =
    state.headlinesStatus === 'loading'
      ? 'Loading…'
      : state.headlinesStale
        ? 'Stale cache'
        : state.headlinesThin
          ? 'Limited coverage'
          : n
            ? `${n} stories`
            : 'No stories';

  const tabs = HEADLINE_CATS.map(
    (c) =>
      `<button type="button" class="hl-tab ${state.headlineCategory === c.id ? 'selected' : ''}" data-hl-cat="${c.id}">${HEADLINE_CAT_ICONS[c.id]}<span>${c.label}</span></button>`,
  ).join('');

  let body: string;
  if (!n) {
    body = `<div class="hl-empty">${
      state.headlinesStatus === 'loading'
        ? 'Loading headlines…'
        : escapeHtml(
            state.headlinesNote ||
              'No headlines for this category right now. Sources may be thin — try another tab shortly.',
          )
    }</div>`;
  } else {
    const items = state.headlines.filter((h) => !!h.image);
    const nImg = items.length;
    if (!nImg) {
      body = `<div class="hl-empty">${escapeHtml(
        state.headlinesNote ||
          'No image headlines for this category right now. Try another tab shortly.',
      )}</div>`;
    } else {
      const slide = ((state.headlineSlide % nImg) + nImg) % nImg;
      const cards: string[] = [];
      const show = Math.min(HEADLINE_VISIBLE, nImg);
      for (let i = 0; i < show; i++) {
        const h = items[(slide + i) % nImg]!;
        const blurb = h.summary
          ? `<p class="hl-blurb">${escapeHtml(h.summary)}</p>`
          : '';
        const when = relativeTime(h.publishedAt, h.publishedMs);
        cards.push(`
        <a class="hl-card ${h.mediaType === 'video' ? 'hl-card-video' : ''}" href="${escapeHtml(h.link)}" target="_blank" rel="noopener noreferrer">
          ${headlineImageHtml(h)}
          ${h.mediaType === 'video' ? '<span class="hl-play" aria-label="Video">▶</span>' : ''}
          <div class="hl-body">
            <h3 class="hl-title">${escapeHtml(h.title)}</h3>
            ${blurb}
            <div class="hl-meta">
              <span class="hl-source">${escapeHtml(h.source)}</span>
              ${when ? `<span class="hl-time">${escapeHtml(when)}</span>` : ''}
            </div>
          </div>
        </a>`);
      }

      const dots =
        nImg > 1
          ? `<div class="hl-dots" role="tablist" aria-label="Headline slides">
            ${items
              .map(
                (_, i) =>
                  `<button type="button" class="hl-dot ${i === slide ? 'active' : ''}" data-hl-slide="${i}" aria-label="Slide ${i + 1}"></button>`,
              )
              .join('')}
          </div>`
          : '';

      const animClass =
        state.headlineAnim === 'exit'
          ? ' hl-track--exit'
          : state.headlineAnim === 'enter'
            ? ' hl-track--enter'
            : '';
      body = `
      <div class="hl-carousel" id="hl-carousel">
        <button type="button" class="hl-nav hl-prev" data-hl-nav="-1" aria-label="Previous headlines">‹</button>
        <div class="hl-track${animClass}">${cards.join('')}</div>
        <button type="button" class="hl-nav hl-next" data-hl-nav="1" aria-label="Next headlines">›</button>
      </div>
      ${dots}`;
    }
  }

  const note =
    state.headlinesNote && (state.headlinesThin || state.headlinesStatus === 'err' || !n)
      ? `<div class="bubble-note">${escapeHtml(state.headlinesNote)}</div>`
      : '';

  return `
    <section aria-label="Recent headlines" class="headlines-section" id="headlines-section">
      <div class="section-label">Recent Headlines · RSS ${status !== 'Loading…' ? `· ${escapeHtml(status)}` : ''}</div>
      <div class="hl-tabs" role="tablist" aria-label="Headline category">${tabs}</div>
      ${note}
      ${body}
      <div class="hl-footnote">Public RSS aggregation — not affiliated with the publishers.</div>
      ${moduleMetaHtml('Public RSS', state.headlinesAsOf)}
    </section>`;
}


/**
 * Birdeye-style: compact bubble panel (fixed aspect), independent of pumps/dumps height.
 * SVG viewBox follows the canvas box so disks fill edge-to-edge.
 */
let moversSyncPasses = 0;
/** Animate bubble morph on TF/data updates; skip on resize for snappiness. */
let bubbleAnimNext = true;
let lastBubblePaintKey = '';
let lastBubbleSizeKey = '';

function bubblePaintKey(): string {
  const rows = state.bubbles
    .map(
      (b) =>
        `${b.id}:${Math.round(b.changePercent ?? 0)}:${Math.round((b.volume ?? 0) / 1000)}`,
    )
    .join('|');
  return `${state.bubbleCategory}|${state.bubbleTf}|${state.bubbleStatus}|${rows}`;
}

function syncMoversLayout(): void {
  const bubbleSec = document.querySelector('.bubble-section') as HTMLElement | null;
  const canvas = document.querySelector('.bubble-canvas') as HTMLElement | null;
  if (!bubbleSec || !canvas) return;

  // Never stretch bubble panel to the tall pumps+dumps column
  bubbleSec.style.height = '';

  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (cw < 48 || ch < 48) {
    if (moversSyncPasses < 8) {
      moversSyncPasses += 1;
      requestAnimationFrame(() => syncMoversLayout());
    }
    return;
  }
  moversSyncPasses = 0;

  const viewW = BUBBLE_W;
  const viewH = Math.max(280, Math.round(viewW * (ch / Math.max(cw, 1))));
  const sizeKey = `${viewW}x${viewH}`;
  const dataKey = bubblePaintKey();
  const dataChanged = dataKey !== lastBubblePaintKey;
  const sizeChanged = sizeKey !== lastBubbleSizeKey;
  const hasSvg = Boolean(canvas.querySelector('.bubble-svg, .bubble-empty'));

  // Full page re-render recreates the canvas — always paint, but only morph when data changed
  const animate = bubbleAnimNext && dataChanged;
  bubbleAnimNext = true;

  if (!dataChanged && !sizeChanged && hasSvg) {
    // Same bubbles + size; canvas was wiped by render() so still need a paint, but no bounce
    paintBubbleMap(canvas, state.bubbles, {
      width: viewW,
      height: viewH,
      tfLabel: state.bubbleTfLabel,
      emptyMessage: bubbleEmptyMessage(),
      category: state.bubbleCategory,
      animate: false,
    });
    return;
  }

  lastBubblePaintKey = dataKey;
  lastBubbleSizeKey = sizeKey;
  paintBubbleMap(canvas, state.bubbles, {
    width: viewW,
    height: viewH,
    tfLabel: state.bubbleTfLabel,
    emptyMessage: bubbleEmptyMessage(),
    category: state.bubbleCategory,
    animate: sizeChanged && !dataChanged ? false : animate,
  });
}

function scheduleSyncMoversLayout(opts?: { animate?: boolean }): void {
  if (opts?.animate === false) bubbleAnimNext = false;
  moversSyncPasses = 0;
  requestAnimationFrame(() => syncMoversLayout());
}

/* ── Auth + hero editor ── */
type HeroEditUi = {
  section: 'hero' | 'indexes';
  slot: number;
  query: string;
  assets: HeroAssetDef[];
  loading: boolean;
  error: string;
};

let heroEdit: HeroEditUi | null = null;
let heroEditFetchTimer: ReturnType<typeof setTimeout> | null = null;
let heroEditAbort: AbortController | null = null;

type PanelEditUi = {
  side: 'left' | 'right';
  draft: PanelConfig;
  query: string;
  assets: HeroAssetDef[];
  loading: boolean;
  error: string;
  saving: boolean;
};
let panelEdit: PanelEditUi | null = null;
let panelEditFetchTimer: ReturnType<typeof setTimeout> | null = null;
let panelEditAbort: AbortController | null = null;

const GOOGLE_G_SVG = `<svg class="auth-provider-icon" viewBox="0 0 18 18" width="14" height="14" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>`;

const MICROSOFT_SVG = `<svg class="auth-provider-icon" viewBox="0 0 18 18" width="14" height="14" aria-hidden="true"><rect x="1" y="1" width="7.5" height="7.5" fill="#F25022"/><rect x="9.5" y="1" width="7.5" height="7.5" fill="#7FBA00"/><rect x="1" y="9.5" width="7.5" height="7.5" fill="#00A4EF"/><rect x="9.5" y="9.5" width="7.5" height="7.5" fill="#FFB900"/></svg>`;

function magicNoteText(): string {
  return magicUi.note || state.authNote || '';
}

function authChipHtml(): string {
  if (state.user) {
    const pic = state.user.picture
      ? `<img class="auth-avatar" src="${escapeHtml(state.user.picture)}" alt="" width="22" height="22" referrerpolicy="no-referrer" />`
      : `<span class="auth-avatar auth-avatar-ph" aria-hidden="true"></span>`;
    const eyeOpen =
      '<svg class="auth-eye-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 5c-5.5 0-9.5 4.5-10.7 6.2a1.2 1.2 0 0 0 0 1.6C2.5 14.5 6.5 19 12 19s9.5-4.5 10.7-6.2a1.2 1.2 0 0 0 0-1.6C21.5 9.5 17.5 5 12 5Zm0 11.2A4.2 4.2 0 1 1 12 7.8a4.2 4.2 0 0 1 0 8.4Zm0-2.4a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z"/></svg>';
    const eyeOff =
      '<svg class="auth-eye-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M3.3 2.2 2.2 3.3l3.1 3.1C3.5 8 1.9 10 1.3 11a1.2 1.2 0 0 0 0 1.6C2.5 14.5 6.5 19 12 19c2 0 3.7-.5 5.2-1.3l3.5 3.5 1.1-1.1L3.3 2.2Zm8.7 14.6c-4.4 0-7.7-3.3-8.9-5.2.6-1 1.8-2.5 3.4-3.6l1.7 1.7a4.2 4.2 0 0 0 5.9 5.9l1.3 1.3c-1 .5-2.1.9-3.4.9Zm10.7-5.2c-.4.6-1.1 1.5-2.1 2.5l-1.5-1.5c.7-.7 1.3-1.4 1.7-2-.6-1-1.8-2.5-3.4-3.6A8.6 8.6 0 0 0 12 6.8c-.5 0-1 .05-1.4.14L9.1 5.4C10 5.1 11 5 12 5c5.5 0 9.5 4.5 10.7 6.2a1.2 1.2 0 0 1 0 1.4Z"/></svg>';
    const tip = hideAuthIdentity ? 'Show name' : 'Hide name';
    const eyeBtn = `<button type="button" class="auth-eye-btn" data-auth="toggle-identity" title="${tip}" aria-label="${tip}" aria-pressed="${hideAuthIdentity ? 'true' : 'false'}">${hideAuthIdentity ? eyeOff : eyeOpen}</button>`;
    // Shown: eye left of avatar/name. Hidden: eye sits next to Sign out (right side).
    const body = hideAuthIdentity
      ? `${eyeBtn}<button type="button" class="auth-btn" data-auth="logout">Sign out</button>`
      : `${eyeBtn}${pic}<span class="auth-name" title="${escapeHtml(state.user.email)}">${escapeHtml(state.user.name || state.user.email)}</span><button type="button" class="auth-btn" data-auth="logout">Sign out</button>`;
    return `<div class="auth-chip signed-in${hideAuthIdentity ? ' identity-hidden' : ''}">
      ${body}
    </div>`;
  }
  const noteRaw = magicNoteText();
  const note = noteRaw
    ? `<span class="auth-note" title="${escapeHtml(noteRaw)}">${escapeHtml(noteRaw)}</span>`
    : '';
  const sending = magicUi.phase === 'sending';
  const verifying = magicUi.phase === 'verifying';
  const showCode = magicUi.phase === 'sent' || magicUi.phase === 'verifying' || magicUi.code.length > 0;
  const codeRow = showCode
    ? `<input data-magic="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code" value="${escapeHtml(magicUi.code)}" aria-label="Sign-in code" />
       <button type="button" class="auth-btn auth-btn-primary" data-auth="magic-verify" ${verifying || magicUi.code.trim().length !== 6 ? 'disabled' : ''}>${verifying ? 'Verifying…' : 'Verify'}</button>`
    : '';
  // Keep panel open while mid magic-flow so codes aren't lost on re-render
  const open = loginMenuOpen || showCode || sending || verifying || !!noteRaw;
  const tip =
    'Sign in to customize your dashboard — once logged in, you can edit tiles and layout to match how you watch the market.';
  const panel = open
    ? `<div class="auth-login-panel" role="dialog" aria-label="Sign in options">
        <div class="auth-oauth-row">
          <a class="auth-btn auth-signin" href="${escapeHtml(loginUrl())}" data-auth="login">${GOOGLE_G_SVG}<span>Google</span></a>
          <a class="auth-btn auth-signin" href="${escapeHtml(microsoftLoginUrl())}" data-auth="login-ms">${MICROSOFT_SVG}<span>Microsoft</span></a>
        </div>
        <form class="magic-auth" data-magic-form="1" autocomplete="on">
          <input data-magic="email" type="email" autocomplete="email" placeholder="you@email.com" value="${escapeHtml(magicUi.email)}" aria-label="Email for magic code" />
          <button type="submit" class="auth-btn auth-btn-primary" data-auth="magic-request" ${sending || !magicUi.email.includes('@') ? 'disabled' : ''}>${sending ? 'Sending…' : 'Email me a code'}</button>
          ${codeRow}
        </form>
        ${note}
      </div>`
    : '';
  return `<div class="auth-chip auth-chip-menu${open ? ' is-open' : ''}">
    <button type="button" class="auth-btn auth-login-trigger" data-auth="toggle-login" aria-expanded="${open ? 'true' : 'false'}" aria-haspopup="dialog">
      <svg class="auth-login-user-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2.25c-4.14 0-7.5 2.1-7.5 4.69V21h15v-2.06c0-2.59-3.36-4.69-7.5-4.69Z"/></svg>
      <span>Log in</span>
    </button>
    <div class="auth-login-tip" role="tooltip">${escapeHtml(tip)}</div>
    ${panel}
  </div>`;
}



/** Short ticker blurb — word-bounded, no trailing ellipsis. */
function shortTickerHeadline(raw: string, maxLen = 72): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  // Drop common noisy prefixes / site suffixes
  s = s.replace(/^(BREAKING|UPDATE|LIVE|WATCH)\s*[:\-|–—]\s*/i, '');
  s = s.replace(/\s*[\|–—-]\s*(Reuters|AP|Bloomberg|CNBC|WSJ|NYT|BBC).*$/i, '');
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const sp = cut.lastIndexOf(' ');
  const base = (sp > 40 ? cut.slice(0, sp) : cut).trim();
  // Prefer ending on word; no "..."
  return base.replace(/[,:;\-–—]+$/, '').trim();
}

/** Persistent ticker root (outside #app so render() never resets scroll). */
let tickerPaused = false;
let tickerAnim: Animation | null = null;
let tickerFingerprint = '';
/** ~Birdeye-slow constant drift (px/sec) — duration derived from content width. */
const TICKER_SPEED_PX = 20;

function ensureTickerRoot(): HTMLElement {
  let root = document.getElementById('news-ticker-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'news-ticker-root';
    root.className = 'news-ticker-host';
    // Always pin ticker as the first body child (above brand chrome)
    document.body.prepend(root);
  } else if (root !== document.body.firstElementChild) {
    document.body.prepend(root);
  }
  return root;
}

function tickerItemHtml(h: HeadlineItem): string {
  const src = escapeHtml(h.source || (h.mediaType === 'video' ? 'Video' : 'Story'));
  const full = escapeHtml(h.title);
  const short = escapeHtml(shortTickerHeadline(h.title));
  const href = escapeHtml(h.link);
  return `<a class="news-ticker-item" href="${href}" target="_blank" rel="noopener noreferrer" title="${full}">
      <span class="ticker-sep" aria-hidden="true">→</span>
      <span class="ticker-src">${src}</span>
      <span class="ticker-title">${short}</span>
    </a>`;
}

function tickerItemsFingerprint(items: HeadlineItem[]): string {
  return items.map((h) => `${h.link}|${shortTickerHeadline(h.title)}`).join('\n');
}

function stopTickerMotion(): void {
  tickerAnim?.cancel();
  tickerAnim = null;
}

function syncTickerAnimPlayState(): void {
  if (!tickerAnim) return;
  if (tickerPaused) tickerAnim.pause();
  else tickerAnim.play();
}

function startTickerWaapi(track: HTMLElement, halfW: number, progress01: number): void {
  stopTickerMotion();
  if (halfW <= 0) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
    track.style.transform = 'translate3d(0,0,0)';
    return;
  }
  const durationMs = Math.max(30_000, (halfW / TICKER_SPEED_PX) * 1000);
  try {
    // Compositor-friendly transform animation (survives main-thread jank better than rAF)
    tickerAnim = track.animate(
      [
        { transform: 'translate3d(0,0,0)' },
        { transform: `translate3d(${-halfW}px,0,0)` },
      ],
      {
        duration: durationMs,
        iterations: Infinity,
        easing: 'linear',
      },
    );
    const prog = ((progress01 % 1) + 1) % 1;
    tickerAnim.currentTime = prog * durationMs;
    syncTickerAnimPlayState();
  } catch {
    // Fallback CSS animation if WAAPI unavailable
    track.style.animation = `ticker-scroll ${durationMs}ms linear infinite`;
    track.style.animationDelay = `${-(((progress01 % 1) + 1) % 1) * durationMs}ms`;
  }
}

function paintTicker(): void {
  const root = ensureTickerRoot();
  if (!tickerItems.length) {
    const msg =
      tickerStatus === 'loading' ? 'Loading headlines…' : 'Headlines ticker warming up…';
    root.innerHTML = `<div class="news-ticker" data-empty="1" aria-label="Market headlines ticker">
      <span class="news-ticker-label">News</span>
      <div class="news-ticker-viewport"><span class="news-ticker-empty">${escapeHtml(msg)}</span></div>
    </div>`;
    tickerFingerprint = '';
    stopTickerMotion();
    return;
  }

  const fp = tickerItemsFingerprint(tickerItems);
  const trackExisting = root.querySelector('.news-ticker-track') as HTMLElement | null;
  const animLive =
    tickerAnim &&
    (tickerAnim.playState === 'running' || tickerAnim.playState === 'paused');
  if (trackExisting && fp === tickerFingerprint && animLive) {
    // Same headlines + live WAAPI — leave the running animation alone (no hitch)
    return;
  }

  // Preserve progress across content swaps
  let progress01 = 0;
  if (tickerAnim && tickerAnim.effect) {
    const timing = tickerAnim.effect.getTiming();
    const dur = typeof timing.duration === 'number' ? timing.duration : 0;
    const cur = typeof tickerAnim.currentTime === 'number' ? tickerAnim.currentTime : 0;
    if (dur > 0) progress01 = (cur % dur) / dur;
  }

  const sequence = tickerItems.map(tickerItemHtml).join('');
  if (!trackExisting) {
    root.innerHTML = `<div class="news-ticker" aria-label="Market headlines ticker">
      <span class="news-ticker-label">News</span>
      <div class="news-ticker-viewport">
        <div class="news-ticker-track">${sequence}${sequence}</div>
      </div>
    </div>`;
    bindTickerHover(root);
  } else {
    trackExisting.innerHTML = `${sequence}${sequence}`;
  }
  tickerFingerprint = fp;

  // Double rAF: wait for layout so scrollWidth is accurate
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = root.querySelector('.news-ticker-track') as HTMLElement | null;
      if (!el) return;
      const halfW = el.scrollWidth / 2;
      startTickerWaapi(el, halfW, progress01);
    });
  });
}

function bindTickerHover(root: HTMLElement): void {
  const bar = root.querySelector('.news-ticker');
  if (!bar || (bar as HTMLElement).dataset.hoverBound) return;
  (bar as HTMLElement).dataset.hoverBound = '1';
  bar.addEventListener('mouseenter', () => {
    tickerPaused = true;
    syncTickerAnimPlayState();
  });
  bar.addEventListener('mouseleave', () => {
    tickerPaused = false;
    syncTickerAnimPlayState();
  });
}

/** After tab freeze/hide, WAAPI may be paused or canceled — resume without DOM wipe when possible. */
function resumeTickerOnVisible(): void {
  if (!tickerItems.length) {
    paintTicker();
    return;
  }
  if (
    tickerAnim &&
    (tickerAnim.playState === 'running' || tickerAnim.playState === 'paused')
  ) {
    syncTickerAnimPlayState();
    return;
  }
  // Animation lost (browser canceled while backgrounded) — rebuild motion only
  tickerFingerprint = '';
  paintTicker();
}

function heroEditPopHtml(): string {
  if (!heroEdit) return '';
  const list = heroEdit.loading
    ? `<div class="hero-edit-empty">Searching…</div>`
    : heroEdit.assets.length
      ? `<ul class="hero-edit-list" role="listbox">${heroEdit.assets
          .map(
            (a) =>
              `<li role="option"><button type="button" class="hero-edit-item" data-hero-pick="${escapeHtml(a.yahoo)}" title="${escapeHtml(a.yahoo)}"><span class="hero-edit-label">${escapeHtml(a.label)}</span><span class="hero-edit-meta">${escapeHtml(a.name ?? a.yahoo)}</span></button></li>`,
          )
          .join('')}</ul>`
      : `<div class="hero-edit-empty">No matches</div>`;
  const err = heroEdit.error
    ? `<div class="hero-edit-err">${escapeHtml(heroEdit.error)}</div>`
    : '';
  const sectionLabel = heroEdit.section === 'indexes' ? 'index tile' : 'tile';
  return `<div class="hero-edit-pop" role="dialog" aria-label="Choose asset" data-hero-edit-slot="${heroEdit.slot}" data-edit-section="${heroEdit.section}">
    <div class="hero-edit-head">Change ${sectionLabel} ${heroEdit.slot + 1}</div>
    <input class="hero-edit-search" type="search" placeholder="Search assets…" value="${escapeHtml(heroEdit.query)}" autocomplete="off" aria-label="Search assets" />
    ${err}
    ${list}
  </div>`;
}

function emptyQuoteFromDef(d: HeroAssetDef): MarketQuote {
  return {
    id: d.id,
    symbol: d.yahoo,
    label: d.label,
    name: d.name,
    price: null,
    changePercent: null,
    marketCap: null,
    unit: d.unit,
    ok: false,
    source: 'yahoo',
    sparkline: null,
  };
}

function applyHeroDefs(defs: HeroAssetDef[]): void {
  state.heroDefs = defs.map((d) => ({ ...d }));
  state.hero = defs.map((d, i) => {
    const prev = state.hero[i];
    if (prev && prev.symbol === d.yahoo && prev.id === d.id) {
      return { ...prev, label: d.label, name: d.name, unit: d.unit };
    }
    return emptyQuoteFromDef(d);
  });
}

function applyIndexDefs(defs: HeroAssetDef[]): void {
  state.indexDefs = defs.map((d) => ({ ...d }));
  state.indexes = defs.map((d, i) => {
    const prev = state.indexes[i];
    if (prev && prev.symbol === d.yahoo && prev.id === d.id) {
      return { ...prev, label: d.label, name: d.name, unit: d.unit };
    }
    return emptyQuoteFromDef(d);
  });
}

function yahooSymbolsForFetch(): string[] {
  const set = new Set(uniqueYahooSymbols());
  for (const d of state.heroDefs) set.add(d.yahoo);
  for (const d of state.indexDefs) set.add(d.yahoo);
  for (const w of watchlist) set.add(w.yahoo);
  if (dashSearch.focusedYahoo) set.add(dashSearch.focusedYahoo);
  return [...set];
}

type YahooLookup = (yahoo: string) => Parameters<typeof toMarketQuote>[1];

function syncWatchQuotesFromMap(lookup: YahooLookup): void {
  const symbols = new Set<string>();
  for (const w of watchlist) symbols.add(w.yahoo);
  if (dashSearch.focusedYahoo) symbols.add(dashSearch.focusedYahoo);
  for (const yahoo of symbols) {
    const key = yahoo.toUpperCase();
    const prev = watchQuotes.get(key);
    const wl = watchlist.find((w) => w.yahoo.toUpperCase() === key);
    const def = {
      id: wl?.id ?? prev?.id ?? `watch-${yahoo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      yahoo,
      label: wl?.label ?? prev?.label ?? yahoo,
      name: wl?.name ?? prev?.name,
      unit: (prev?.unit as string) || 'usd',
    };
    const q = toMarketQuote(def, lookup(yahoo), prev);
    watchQuotes.set(key, q);
  }
  if (dashSearch.focusedYahoo) {
    const q = watchQuotes.get(dashSearch.focusedYahoo.toUpperCase());
    if (q && q.price != null) dashSearch.focusedStatus = 'ok';
    else if (q?.stale && q.price != null) dashSearch.focusedStatus = 'ok';
    else dashSearch.focusedStatus = dashSearch.focusedStatus === 'loading' ? 'loading' : 'err';
  }
}

async function openHeroEditor(slot: number, section: 'hero' | 'indexes' = 'hero'): Promise<void> {
  heroEdit = { section, slot, query: '', assets: [], loading: true, error: '' };
  render();
  const input = document.querySelector<HTMLInputElement>('.hero-edit-search');
  input?.focus();
  await loadHeroEditAssets('');
}

function closeHeroEditor(): void {
  if (heroEditFetchTimer) {
    clearTimeout(heroEditFetchTimer);
    heroEditFetchTimer = null;
  }
  if (heroEditAbort) {
    heroEditAbort.abort();
    heroEditAbort = null;
  }
  if (!heroEdit) return;
  heroEdit = null;
  render();
}

async function loadHeroEditAssets(q: string): Promise<void> {
  if (!heroEdit) return;
  if (heroEditAbort) heroEditAbort.abort();
  heroEditAbort = new AbortController();
  const signal = heroEditAbort.signal;
  heroEdit.loading = true;
  heroEdit.error = '';
  // Soft update list area without losing input focus if possible
  const listHost = document.querySelector('.hero-edit-pop');
  if (listHost) {
    const empty = listHost.querySelector('.hero-edit-empty, .hero-edit-list');
    if (empty) empty.outerHTML = `<div class="hero-edit-empty">Searching…</div>`;
  }
  try {
    const assets = await fetchAssets(q, signal);
    if (signal.aborted || !heroEdit) return;
    heroEdit.assets = assets;
    heroEdit.loading = false;
    render();
    const input = document.querySelector<HTMLInputElement>('.hero-edit-search');
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  } catch {
    if (signal.aborted || !heroEdit) return;
    heroEdit.loading = false;
    heroEdit.error = 'Failed to load assets';
    render();
  }
}

function scheduleHeroEditSearch(q: string): void {
  if (!heroEdit) return;
  heroEdit.query = q;
  if (heroEditFetchTimer) clearTimeout(heroEditFetchTimer);
  heroEditFetchTimer = setTimeout(() => {
    heroEditFetchTimer = null;
    void loadHeroEditAssets(q);
  }, 180);
}

async function pickHeroAsset(yahoo: string): Promise<void> {
  if (!heroEdit || !state.user) return;
  const slot = heroEdit.slot;
  const section = heroEdit.section;
  const assets = heroEdit.assets;
  const picked =
    assets.find((a) => a.yahoo === yahoo) ??
    (await fetchAssets(yahoo)).find((a) => a.yahoo === yahoo || a.id === yahoo);
  if (!picked) {
    if (heroEdit) heroEdit.error = 'Asset not found';
    render();
    return;
  }
  if (section === 'indexes') {
    const next = state.indexDefs.map((d) => ({ ...d }));
    next[slot] = { ...picked };
    applyIndexDefs(next);
    closeHeroEditor();
    render();
    const saved = await saveIndexLayout(state.indexDefs);
    if (saved) applyIndexDefs(saved);
    try {
      await refreshYahoo();
      try {
        const d = state.indexDefs[slot]!;
        const series = await fetchChartSeries(d.yahoo, '1y', '1d');
        if (series.ok && series.closes.length > 1 && state.indexes[slot]) {
          state.indexes[slot] = { ...state.indexes[slot]!, sparkline: series.closes };
        }
      } catch {
        /* keep */
      }
    } catch {
      /* stale flags set inside refreshYahoo */
    }
    render();
    return;
  }
  const next = state.heroDefs.map((d) => ({ ...d }));
  next[slot] = { ...picked };
  applyHeroDefs(next);
  closeHeroEditor();
  render();
  const saved = await saveHeroLayout(state.heroDefs);
  if (saved) applyHeroDefs(saved);
  try {
    await refreshYahoo();
    // Refresh spark for this slot
    try {
      const d = state.heroDefs[slot]!;
      const series = await fetchChartSeries(d.yahoo, '1y', '1d');
      if (series.ok && series.closes.length > 1 && state.hero[slot]) {
        state.hero[slot] = { ...state.hero[slot]!, sparkline: series.closes };
      }
    } catch {
      /* keep */
    }
  } catch {
    /* stale flags set inside refreshYahoo */
  }
  render();
}

async function loadHeroLayoutForUser(): Promise<void> {
  const layout = await fetchHeroLayout();
  if (layout && !layout.guest && layout.hero.length === 6) {
    applyHeroDefs(layout.hero);
  }
}

async function loadIndexLayoutForUser(): Promise<void> {
  const layout = await fetchIndexLayout();
  if (layout && !layout.guest && layout.indexes.length === INDEX_SYMBOLS.length) {
    applyIndexDefs(layout.indexes);
  }
}

function clonePanelConfig(cfg: PanelConfig): PanelConfig {
  return {
    ...cfg,
    assets: cfg.assets.map((a) => ({ ...a })),
  };
}

function applyPanelsLayout(panels: PanelsLayout): void {
  state.panels = {
    left: clonePanelConfig(panels.left),
    right: clonePanelConfig(panels.right),
  };
  // Keep legacy TF mirrors in sync for movers modes
  state.trendingPumpsTf = panels.left.tf as TrendingTf;
  state.trendingDumpsTf = panels.right.tf as TrendingTf;
}

function resetPanelsToDefaults(): void {
  applyPanelsLayout({
    left: { ...DEFAULT_PANELS.left, assets: [] },
    right: { ...DEFAULT_PANELS.right, assets: [] },
  });
  state.panelVolumeFallback = { left: false, right: false };
}

async function loadPanelsLayoutForUser(): Promise<void> {
  const layout = await fetchPanelsLayout();
  if (layout && !layout.guest) {
    applyPanelsLayout(layout.panels);
  }
}

async function loadLayoutsForUser(): Promise<void> {
  await Promise.all([
    loadHeroLayoutForUser(),
    loadIndexLayoutForUser(),
    loadPanelsLayoutForUser(),
  ]);
}

function closePanelEditor(): void {
  if (panelEditFetchTimer) {
    clearTimeout(panelEditFetchTimer);
    panelEditFetchTimer = null;
  }
  if (panelEditAbort) {
    panelEditAbort.abort();
    panelEditAbort = null;
  }
  if (!panelEdit) return;
  panelEdit = null;
  render();
}

async function openPanelEditor(side: 'left' | 'right'): Promise<void> {
  if (!state.user) return;
  closeHeroEditor();
  panelEdit = {
    side,
    draft: clonePanelConfig(state.panels[side]),
    query: '',
    assets: [],
    loading: false,
    error: '',
    saving: false,
  };
  render();
  const titleInput = document.querySelector<HTMLInputElement>(
    `.panel-edit-pop[data-panel-edit-side="${side}"] .panel-edit-title`,
  );
  titleInput?.focus();
  if (panelEdit.draft.mode === 'curated') {
    panelEdit.loading = true;
    render();
    await loadPanelEditAssets('');
  }
}

async function loadPanelEditAssets(q: string): Promise<void> {
  if (!panelEdit) return;
  if (panelEditAbort) panelEditAbort.abort();
  panelEditAbort = new AbortController();
  const signal = panelEditAbort.signal;
  panelEdit.loading = true;
  panelEdit.error = '';
  try {
    const assets = await fetchAssets(q, signal);
    if (signal.aborted || !panelEdit) return;
    panelEdit.assets = assets;
    panelEdit.loading = false;
    render();
    const input = document.querySelector<HTMLInputElement>('.panel-edit-search');
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  } catch {
    if (signal.aborted || !panelEdit) return;
    panelEdit.loading = false;
    panelEdit.error = 'Failed to load assets';
    render();
  }
}

function schedulePanelEditSearch(q: string): void {
  if (!panelEdit) return;
  panelEdit.query = q;
  if (panelEditFetchTimer) clearTimeout(panelEditFetchTimer);
  panelEditFetchTimer = setTimeout(() => {
    panelEditFetchTimer = null;
    void loadPanelEditAssets(q);
  }, 180);
}

async function savePanelEditor(): Promise<void> {
  if (!panelEdit || !state.user) return;
  const side = panelEdit.side;
  const draft = clonePanelConfig(panelEdit.draft);
  draft.title = draft.title.trim() || state.panels[side].title;
  if (draft.mode === 'curated' && draft.assets.length === 0) {
    panelEdit.error = 'Add at least one asset to the curated list';
    render();
    return;
  }
  panelEdit.saving = true;
  panelEdit.error = '';
  const next: PanelsLayout = {
    left: side === 'left' ? draft : clonePanelConfig(state.panels.left),
    right: side === 'right' ? draft : clonePanelConfig(state.panels.right),
  };
  applyPanelsLayout(next);
  panelEdit = null;
  render();
  const saved = await savePanelsLayout(state.panels);
  if (saved) applyPanelsLayout(saved);
  await refreshPanelSide(side);
  render();
}

function sortKeyValue(item: TrendingItem, sort: PanelSort): number {
  switch (sort) {
    case 'mcap':
      return item.marketCap ?? -1;
    case 'volume_24h':
    case 'volume_7d':
    case 'volume_30d':
      return item.volume ?? -1;
    case 'change':
    default:
      return item.changePercent ?? -Infinity;
  }
}

function sortPanelItems(items: TrendingItem[], cfg: PanelConfig): TrendingItem[] {
  const sorted = [...items];
  if (cfg.mode === 'movers_down' && cfg.sort === 'change') {
    sorted.sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0));
  } else if (cfg.sort === 'change' && cfg.mode === 'movers_up') {
    sorted.sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
  } else if (cfg.sort === 'change') {
    sorted.sort(
      (a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0),
    );
  } else {
    sorted.sort((a, b) => sortKeyValue(b, cfg.sort) - sortKeyValue(a, cfg.sort));
  }
  return sorted.slice(0, cfg.size).map((r, i) => ({ ...r, rank: i + 1 }));
}

function chartKindFromYahoo(yahoo: string, unit?: string): TrendingItem['chartKind'] {
  const y = yahoo.toUpperCase();
  if (/-USD$/i.test(y)) return 'crypto';
  if (y.startsWith('^')) return 'index';
  if (/=F$/i.test(y)) return 'hero';
  if (unit === 'index') return 'index';
  return 'stock';
}

function quoteToPanelItem(
  def: { id: string; yahoo: string; label: string; name?: string; unit?: string },
  raw: { price: number | null; changePercent: number | null; marketCap?: number | null; ok: boolean } | undefined,
  index: number,
): TrendingItem {
  const kind = chartKindFromYahoo(def.yahoo, def.unit);
  const sym = def.label || def.yahoo.replace(/-USD$/i, '');
  return {
    id: def.id,
    symbol: sym,
    name: def.name ?? def.label,
    image: kind === 'crypto' ? null : stockLogoUrl(def.yahoo),
    price: raw?.ok ? raw.price : null,
    rank: index + 1,
    score: null,
    marketCapRank: null,
    changePercent: raw?.ok ? raw.changePercent : null,
    volume: null,
    marketCap: raw?.marketCap ?? null,
    yahoo: def.yahoo,
    chartKind: kind,
  };
}

async function fetchCuratedPanelItems(cfg: PanelConfig): Promise<{
  items: TrendingItem[];
  note: string;
  volumeFallback: boolean;
}> {
  const assets = cfg.mode === 'filter_metals' ? METALS_PRESET : cfg.assets;
  if (!assets.length) {
    return {
      items: [],
      note: cfg.mode === 'curated' ? 'No assets in curated list.' : 'No metals presets.',
      volumeFallback: false,
    };
  }
  const quotes = await fetchYahooQuotes(assets.map((a) => a.yahoo));
  let items = assets.map((a, i) =>
    quoteToPanelItem(a, quotes.get(a.yahoo) ?? quotes.get(a.yahoo.toUpperCase()), i),
  );
  const volumeFallback =
    cfg.sort === 'volume_7d' || cfg.sort === 'volume_30d' || cfg.sort === 'volume_24h';
  // Yahoo quotes lack reliable multi-day volume here — sort by mcap/change when volume missing
  if (
    (cfg.sort === 'volume_24h' || cfg.sort === 'volume_7d' || cfg.sort === 'volume_30d') &&
    items.every((x) => x.volume == null)
  ) {
    // Fall back to mcap then change
    items = [...items].sort(
      (a, b) =>
        (b.marketCap ?? 0) - (a.marketCap ?? 0) ||
        Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0),
    );
    return {
      items: items.slice(0, cfg.size).map((r, i) => ({ ...r, rank: i + 1 })),
      note: 'Volume unavailable for these assets — sorted by market cap / change (24h volume N/A).',
      volumeFallback: true,
    };
  }
  items = sortPanelItems(items, cfg);
  return {
    items,
    note: '',
    volumeFallback: volumeFallback && (cfg.sort === 'volume_7d' || cfg.sort === 'volume_30d'),
  };
}

function cryptoRowsToPanelItems(cfg: PanelConfig): {
  items: TrendingItem[];
  note: string;
  volumeFallback: boolean;
} {
  const rows = state.cryptoKind === 'l1s' ? filterL1Cryptos(state.cryptos) : state.cryptos;
  let items: TrendingItem[] = rows.map((r, i) => ({
    id: r.id,
    symbol: r.symbol,
    name: r.name,
    image: r.image ?? null,
    price: r.price,
    rank: i + 1,
    score: null,
    marketCapRank: r.rank,
    changePercent: r.changePercent,
    volume: r.volume ?? null,
    marketCap: r.marketCap ?? null,
    chartKind: 'crypto' as const,
  }));
  const volumeFallback = cfg.sort === 'volume_7d' || cfg.sort === 'volume_30d';
  items = sortPanelItems(items, cfg);
  return {
    items,
    note: volumeFallback ? 'Crypto volume is 24h (7d/30d unavailable from feed).' : '',
    volumeFallback,
  };
}

function stockRowsToPanelItems(cfg: PanelConfig): {
  items: TrendingItem[];
  note: string;
  volumeFallback: boolean;
} {
  const rows = state.equityKind === 'etfs' ? state.etfs : state.stocks;
  let items: TrendingItem[] = rows.map((r, i) => ({
    id: r.id,
    symbol: r.label || r.symbol,
    name: r.name ?? r.label,
    image: stockLogoUrl(r.symbol),
    price: r.price,
    rank: i + 1,
    score: null,
    marketCapRank: null,
    changePercent: r.changePercent,
    volume: null,
    marketCap: r.marketCap ?? null,
    yahoo: r.symbol,
    chartKind: 'stock' as const,
  }));
  const volumeFallback =
    cfg.sort === 'volume_24h' || cfg.sort === 'volume_7d' || cfg.sort === 'volume_30d';
  if (volumeFallback && items.every((x) => x.volume == null)) {
    items = [...items].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    return {
      items: items.slice(0, cfg.size).map((r, i) => ({ ...r, rank: i + 1 })),
      note: 'Equity volume unavailable — sorted by market cap.',
      volumeFallback: true,
    };
  }
  items = sortPanelItems(items, cfg);
  return { items, note: '', volumeFallback };
}

async function refreshPanelSide(side: 'left' | 'right'): Promise<void> {
  const cfg = state.panels[side];
  const isLeft = side === 'left';
  const prev = isLeft ? state.trendingPumps : state.trendingDumps;
  const had = prev.length > 0;
  if (isLeft) state.trendingPumpsStatus = had ? 'stale' : 'loading';
  else state.trendingDumpsStatus = had ? 'stale' : 'loading';

  try {
    let items: TrendingItem[] = [];
    let note = '';
    let volumeFallback = false;
    let status: 'ok' | 'stale' | 'err' = 'ok';

    if (cfg.mode === 'movers_up' || cfg.mode === 'movers_down') {
      const data = await fetchTrending(cfg.tf as TrendingTf, undefined, cfg.size);
      // Ignore superseded if TF/mode changed mid-flight
      if (state.panels[side].tf !== cfg.tf || state.panels[side].mode !== cfg.mode) return;
      const raw = cfg.mode === 'movers_up' ? data.pumps : data.dumps;
      items = sortPanelItems(raw ?? [], { ...cfg, sort: cfg.sort === 'change' ? 'change' : cfg.sort });
      // If user wants mcap/volume sort on movers universe, re-sort the combined side list
      if (cfg.sort !== 'change') {
        const pool = [...(data.pumps ?? []), ...(data.dumps ?? [])];
        items = sortPanelItems(pool, cfg);
      }
      note = data.note ?? '';
      status = items.length
        ? data.stale || data.rateLimited
          ? 'stale'
          : 'ok'
        : had
          ? 'stale'
          : 'err';
      state.trendingRateLimited = Boolean(data.rateLimited) || state.trendingRateLimited;
      state.trendingStale = Boolean(data.stale) || state.trendingStale;
    } else if (cfg.mode === 'curated' || cfg.mode === 'filter_metals') {
      const res = await fetchCuratedPanelItems(cfg);
      items = res.items;
      note = res.note;
      volumeFallback = res.volumeFallback;
      status = items.length ? 'ok' : had ? 'stale' : 'err';
    } else if (cfg.mode === 'filter_crypto') {
      const res = cryptoRowsToPanelItems(cfg);
      items = res.items;
      note = res.note;
      volumeFallback = res.volumeFallback;
      status = items.length ? 'ok' : had ? 'stale' : 'err';
    } else if (cfg.mode === 'filter_stocks') {
      const res = stockRowsToPanelItems(cfg);
      items = res.items;
      note = res.note;
      volumeFallback = res.volumeFallback;
      status = items.length ? 'ok' : had ? 'stale' : 'err';
    }

    if (isLeft) {
      if (items.length || !had) state.trendingPumps = items;
      state.trendingPumpsNote = note;
      state.trendingPumpsStatus = status;
      state.trendingPumpsTf = cfg.tf as TrendingTf;
    } else {
      if (items.length || !had) state.trendingDumps = items;
      state.trendingDumpsNote = note;
      state.trendingDumpsStatus = status;
      state.trendingDumpsTf = cfg.tf as TrendingTf;
    }
    state.panelVolumeFallback[side] = volumeFallback;
    state.trendingNote = note;
    syncTrendingAggregateStatus();
  } catch (e) {
    if (state.panels[side].mode !== cfg.mode) return;
    const msg = e instanceof Error ? e.message : 'Panel refresh failed';
    if (isLeft) {
      state.trendingPumpsStatus = had ? 'stale' : 'err';
      state.trendingPumpsNote = msg;
    } else {
      state.trendingDumpsStatus = had ? 'stale' : 'err';
      state.trendingDumpsNote = msg;
    }
    state.trendingNote = msg;
    syncTrendingAggregateStatus();
  }
}

function magicErrorMessage(code: string): string {
  switch (code) {
    case 'auth_not_configured':
      return 'Email sign-in not configured';
    case 'invalid_email':
      return 'Enter a valid email';
    case 'test_mode_recipient':
      return 'Email sign-in is limited right now — try Google or Microsoft';
    case 'send_failed':
      return 'Could not send code — try again';
    case 'temporarily_unavailable':
    case 'unavailable':
      return 'Email sign-in is temporarily unavailable — try Google or Microsoft';
    case 'network':
      return 'Network error';
    case 'invalid':
      return 'Invalid code';
    case 'expired':
      return 'Code expired — request a new one';
    case 'locked':
      return 'Too many attempts — request a new code';
    default:
      return code || 'Something went wrong';
  }
}

async function handleMagicRequest(): Promise<void> {
  const email = magicUi.email.trim();
  if (!email.includes('@')) {
    magicUi.note = 'Enter a valid email';
    render();
    return;
  }
  magicUi.phase = 'sending';
  magicUi.note = '';
  state.authNote = '';
  render();
  const result = await requestMagicLink(email);
  if (!result.ok) {
    magicUi.phase = 'idle';
    magicUi.note = magicErrorMessage(result.error);
    render();
    return;
  }
  magicUi.phase = 'sent';
  magicUi.note = 'Check your inbox for a code';
  magicUi.code = '';
  render();
}

async function handleMagicVerify(): Promise<void> {
  const email = magicUi.email.trim();
  const code = magicUi.code.trim();
  if (!email.includes('@') || code.length !== 6) {
    magicUi.note = 'Enter the 6-digit code';
    render();
    return;
  }
  magicUi.phase = 'verifying';
  magicUi.note = '';
  render();
  const result = await verifyMagicCode(email, code);
  if (!result.ok) {
    magicUi.phase = 'sent';
    magicUi.note = magicErrorMessage(result.error);
    render();
    return;
  }
  state.user = result.user;
  magicUi.phase = 'idle';
  magicUi.note = '';
  magicUi.code = '';
  state.authNote = '';
  await loadLayoutsForUser();
  render();
  try {
    await refreshYahoo();
  } catch {
    /* ignore */
  }
  try {
    await refreshTrending();
  } catch {
    /* ignore */
  }
  render();
}

function rebuildTickerFromPrefetch(): void {
  const seen = new Set<string>();
  const mixed: HeadlineItem[] = [];
  for (const cat of TICKER_CATS) {
    const hit = headlinesPrefetch.get(cat);
    if (!hit?.items?.length) continue;
    for (const item of hit.items.slice(0, 6)) {
      const key = item.link || item.id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      mixed.push(item);
    }
  }
  // Prefer a spread of sources; keep newest-ish first when publishedMs present
  mixed.sort((a, b) => (b.publishedMs ?? 0) - (a.publishedMs ?? 0));
  tickerItems = mixed.slice(0, 36);
  tickerStatus = tickerItems.length ? 'ok' : 'empty';
  paintTicker();
}

async function refreshTicker(): Promise<void> {
  tickerStatus = tickerItems.length ? 'ok' : 'loading';
  const jobs = TICKER_CATS.map(async (cat) => {
    if (headlinesPrefetch.has(cat)) return;
    try {
      const data = await fetchHeadlines(cat);
      headlinesPrefetch.set(cat, data);
    } catch {
      /* ignore per-category failures */
    }
  });
  await Promise.all(jobs);
  rebuildTickerFromPrefetch();
}


async function loadDashSearchResults(q: string): Promise<void> {
  if (dashSearchAbort) dashSearchAbort.abort();
  const ac = new AbortController();
  dashSearchAbort = ac;
  dashSearch.loading = true;
  dashSearch.open = true;
  scheduleRender();
  try {
    const assets = await fetchAssets(q, ac.signal);
    if (ac.signal.aborted) return;
    dashSearch.results = assets;
    dashSearch.loading = false;
    scheduleRender();
  } catch {
    if (ac.signal.aborted) return;
    dashSearch.results = [];
    dashSearch.loading = false;
    scheduleRender();
  }
}

function scheduleDashSearch(q: string): void {
  dashSearch.query = q;
  if (dashSearchTimer) clearTimeout(dashSearchTimer);
  if (!q.trim()) {
    dashSearch.results = [];
    dashSearch.loading = false;
    dashSearch.open = false;
    scheduleRender();
    return;
  }
  dashSearch.open = true;
  dashSearch.loading = true;
  scheduleRender();
  dashSearchTimer = setTimeout(() => {
    void loadDashSearchResults(q.trim());
  }, 220);
}

async function focusDashSymbol(yahoo: string, opts?: { share?: boolean }): Promise<void> {
  const sym = yahoo.trim();
  if (!sym) return;
  dashSearch.focusedYahoo = sym;
  dashSearch.focusedStatus = 'loading';
  dashSearch.open = false;
  dashSearch.query = sym;
  dashSearch.note = '';
  if (opts?.share !== false) setShareQuery(sym);
  scheduleRender();
  try {
    const map = await fetchYahooQuotes([sym]);
    const raw = map.get(sym) ?? map.get(sym.toUpperCase());
    const found =
      dashSearch.results.find((a) => a.yahoo.toUpperCase() === sym.toUpperCase()) ??
      (await fetchAssets(sym)).find(
        (a) => a.yahoo.toUpperCase() === sym.toUpperCase() || a.label.toUpperCase() === sym.toUpperCase(),
      );
    const def = {
      id: found?.id ?? `focus-${sym.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      yahoo: found?.yahoo ?? sym,
      label: found?.label ?? sym,
      name: found?.name,
      unit: found?.unit ?? 'usd',
    };
    const prev = watchQuotes.get(def.yahoo.toUpperCase());
    const q = toMarketQuote(def, raw, prev);
    watchQuotes.set(def.yahoo.toUpperCase(), q);
    dashSearch.focusedYahoo = def.yahoo;
    dashSearch.focusedStatus = q.price != null ? 'ok' : 'err';
    if (q.price != null) state.yahooAsOf = state.yahooAsOf ?? new Date();
    if (opts?.share !== false) setShareQuery(def.yahoo);
  } catch {
    dashSearch.focusedStatus = 'err';
    dashSearch.note = 'Yahoo quote failed';
  }
  scheduleRender();
}

function clearDashFocus(): void {
  dashSearch.focusedYahoo = null;
  dashSearch.focusedStatus = 'idle';
  dashSearch.note = '';
  dashSearch.query = '';
  dashSearch.results = [];
  dashSearch.open = false;
  setShareQuery(null);
  scheduleRender();
}

function starFromAttrs(el: HTMLElement): void {
  const yahoo = el.getAttribute('data-dash-star');
  if (!yahoo) return;
  const item: WatchItem = {
    id: el.getAttribute('data-dash-id') || yahoo,
    yahoo,
    label: el.getAttribute('data-dash-label') || yahoo,
    name: el.getAttribute('data-dash-name') || undefined,
  };
  watchlist = toggleWatchlist(watchlist, item);
  saveWatchlist(watchlist);
  // Ensure quote present on next refresh
  void refreshYahooQuotesForWatch().then(() => scheduleRender());
  scheduleRender();
}

async function refreshYahooQuotesForWatch(): Promise<void> {
  const symbols = [
    ...watchlist.map((w) => w.yahoo),
    ...(dashSearch.focusedYahoo ? [dashSearch.focusedYahoo] : []),
  ];
  if (!symbols.length) return;
  try {
    const map = await fetchYahooQuotes(symbols);
    const lookup = (yahoo: string) => map.get(yahoo) ?? map.get(yahoo.toUpperCase());
    syncWatchQuotesFromMap(lookup);
    state.yahooAsOf = new Date();
  } catch {
    for (const [k, q] of watchQuotes) {
      if (q.price != null) watchQuotes.set(k, { ...q, stale: true });
    }
  }
}

async function bootstrapAuth(): Promise<void> {
  const user = await fetchMe();
  state.user = user;
  if (!user) {
    // Probe google endpoint only on explicit click; guests keep defaults
    return;
  }
  await loadLayoutsForUser();
}

/** True when state changed while tab was hidden — paint once on return. */
let renderDirty = false;
let renderRaf = 0;

function renderNow(): void {
  ensureTickerRoot();
  state.halvingText = formatHalvingCountdown();
  const { local, utc } = formatTimes(state.lastOkAt ?? state.lastAttemptAt);
  const pulseClass =
    state.status === 'ok' ? '' : state.status === 'stale' ? 'stale' : state.status === 'err' ? 'err' : '';
  const asOfShort = shortAsOf(state.lastOkAt ?? state.lastAttemptAt);
  const statusText =
    state.status === 'loading'
      ? 'Quotes loading…'
      : state.status === 'ok'
        ? `Markets live · Updated ${asOfShort}`
        : state.status === 'stale'
          ? `Stale / partial · Updated ${asOfShort}`
          : state.lastOkAt
            ? `Error — last good ${asOfShort}`
            : 'Error — feeds unavailable';

  // Preserve magic-auth / panel-edit input focus across full re-renders
  const prevActive = document.activeElement as HTMLElement | null;
  const magicFocusKey = prevActive?.getAttribute?.('data-magic');
  const panelFocus =
    prevActive?.classList?.contains('panel-edit-title')
      ? 'title'
      : prevActive?.classList?.contains('panel-edit-search')
        ? 'search'
        : null;
  const dashSearchFocused =
    prevActive?.id === 'dash-search-input' ||
    prevActive?.classList?.contains('dash-search-input');
  const selStart =
    (magicFocusKey || panelFocus || dashSearchFocused) &&
    prevActive instanceof HTMLInputElement
      ? prevActive.selectionStart
      : null;
  const selEnd =
    (magicFocusKey || panelFocus || dashSearchFocused) &&
    prevActive instanceof HTMLInputElement
      ? prevActive.selectionEnd
      : null;

  app.innerHTML = `
    <header class="brand">
      <div class="status">
        <span class="pulse ${pulseClass}" aria-hidden="true"></span>
        <span>${statusText}</span>
        <span>↻ ${Math.round(REFRESH_MS / 1000)}s</span>
      </div>
      <a class="brand-lockup" href="/" aria-label="Market Check">
        <img class="brand-logo" src="/market-check-logo.png?v=4" alt="Market Check" width="131" height="39" />
      </a>
      ${authChipHtml()}
    </header>

    ${dashChromeHtml()}

    <section aria-label="Hero markets">
      <div class="section-label">Key markets · crypto, metals, oil, US indexes</div>
      <div class="hero">
        ${state.hero.map((q, i) => tileHtml(q, { hero: true, heroSlot: i })).join('')}
      </div>
      ${heroEditPopHtml()}
      ${moduleMetaHtml('Yahoo (proxied) · BTC via Yahoo/CoinGecko charts', state.yahooAsOf)}
    </section>

    <div class="markets-split">
      <section class="crypto-wrap" aria-label="Top crypto assets by market cap">
        <div class="markets-toolbar">
          <div class="section-label">${cryptoSectionLabel()}</div>
          <div class="markets-toolbar-controls">
            <div class="tf-group" role="group" aria-label="Crypto kind">
              <button type="button" class="tf-btn ${state.cryptoKind === 'all' ? 'selected' : ''}" data-crypto-kind="all">All Crypto</button>
              <button type="button" class="tf-btn ${state.cryptoKind === 'l1s' ? 'selected' : ''}" data-crypto-kind="l1s">L1s</button>
            </div>
            <div class="tf-group markets-limit-group" role="group" aria-label="Crypto list size">
              <button type="button" class="tf-btn ${state.cryptoListLimit === 10 ? 'selected' : ''}" data-crypto-limit="10">Top 10</button>
              <button type="button" class="tf-btn ${state.cryptoListLimit === 25 ? 'selected' : ''}" data-crypto-limit="25">Top 25</button>
            </div>
          </div>
        </div>
        <div class="markets-scroll ${state.cryptoListLimit === 25 ? 'is-scrollable' : ''}">
          <table class="dense-table markets-table crypto-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Ticker</th>
                <th>Name</th>
                <th class="num">Price</th>
                <th class="num">24h %</th>
                <th class="num">Mkt Cap</th>
              </tr>
            </thead>
            <tbody>
              ${cryptoRowsHtml(displayedCryptos())}
            </tbody>
          </table>
        </div>
        ${moduleMetaHtml(
          state.cryptoUnavailable ? 'CoinGecko (unavailable)' : 'CoinGecko',
          state.cryptoAsOf,
          state.cryptoUnavailable ? 'showing placeholders / last cache' : '',
        )}
      </section>

      <section class="stocks-wrap" aria-label="Top equities by market cap">
        <div class="markets-toolbar">
          <div class="section-label">US ${state.equityKind === 'etfs' ? 'ETFs' : 'stocks'} · Top ${state.equityListLimit} by Mkt Cap · liquid universe</div>
          <div class="markets-toolbar-controls">
            <div class="tf-group" role="group" aria-label="Equity kind">
              <button type="button" class="tf-btn ${state.equityKind === 'stocks' ? 'selected' : ''}" data-equity-kind="stocks">Stocks</button>
              <button type="button" class="tf-btn ${state.equityKind === 'etfs' ? 'selected' : ''}" data-equity-kind="etfs">ETFs</button>
            </div>
            <div class="tf-group markets-limit-group" role="group" aria-label="Equity list size">
              <button type="button" class="tf-btn ${state.equityListLimit === 10 ? 'selected' : ''}" data-equity-limit="10">Top 10</button>
              <button type="button" class="tf-btn ${state.equityListLimit === 25 ? 'selected' : ''}" data-equity-limit="25">Top 25</button>
            </div>
          </div>
        </div>
        <div class="markets-scroll ${state.equityListLimit === 25 ? 'is-scrollable' : ''}">
          <table class="dense-table markets-table stocks-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Ticker</th>
                <th>Name</th>
                <th class="num">Price</th>
                <th class="num">24h %</th>
                <th class="num">Mkt Cap</th>
              </tr>
            </thead>
            <tbody>
              ${stockRowsHtml(displayedEquities())}
            </tbody>
          </table>
        </div>
        ${moduleMetaHtml('Yahoo (proxied)', state.yahooAsOf)}
      </section>
    </div>

    <section aria-label="Indexes" class="indexes-section">
      <div class="section-label">World / indexes · ETFs</div>
      <div class="indexes">
        ${state.indexes.map((q, i) => tileHtml(q, { spark: true, indexSlot: i })).join('')}
      </div>
      ${moduleMetaHtml('Yahoo (proxied)', state.yahooAsOf)}
    </section>

    <div class="movers-block">
      <div class="movers-row">
        ${trendingPanelHtml('left')}
        ${trendingPanelHtml('right')}
        <section aria-label="Bubble map" class="bubble-section">
          <div class="section-label">Bubble Map</div>
          ${bubbleControlsHtml()}
          <div class="bubble-canvas" id="bubble-canvas"></div>
          ${moduleMetaHtml(
            state.bubbleCategory === 'cryptos' || state.bubbleCategory === 'solana'
              ? 'CoinGecko / Binance (proxied)'
              : 'Yahoo (proxied)',
            state.lastOkAt,
            state.bubbleStatus === 'err'
              ? 'feed error'
              : state.bubbleStatus === 'stale'
                ? 'stale'
                : '',
          )}
        </section>
      </div>
    </div>

    ${headlinesHtml()}

    ${adSlotHtml('footer')}

    <footer class="foot">
      <p class="foot-lede">A free public dashboard of live market prices and the headlines that move them — crypto quotes, equity quotes, commodities, and news. No account required. Not financial advice.</p>
      <p class="foot-copy">Covers crypto, US equities / ETFs / indexes, commodities, and public news headlines. Data comes from public third-party sources (including CoinGecko, Yahoo Finance, and public RSS) and may be delayed or incorrect.</p>
      <p class="foot-copy">Market Check on marketcheck.money is <strong>not</strong> MarketCheck the car-listing company, and <strong>not</strong> a brokerage, exchange, investment advisor, or bank. Nothing here is a recommendation to buy, sell, or hold any asset.</p>
      <p class="disclaimer">Not financial advice. Third-party data may be delayed or incorrect. Market Check is not a brokerage, exchange, advisor, or bank.</p>
      <nav class="legal-links" aria-label="Legal">
        <a href="/about/">About</a>
        <span aria-hidden="true">·</span>
        <a href="/sources/">Sources</a>
        <span aria-hidden="true">·</span>
        <a href="/privacy/">Privacy</a>
        <span aria-hidden="true">·</span>
        <a href="/terms/">Terms</a>
        <span aria-hidden="true">·</span>
        <a href="/contact/">Contact</a>
      </nav>
      <div class="foot-meta">
        Updated: <strong>${escapeHtml(local)}</strong>
        · <span>${escapeHtml(utc)}</span>
        · Sources: ${escapeHtml(state.sourcesNote)}
        · <a href="https://www.coingecko.com/en/api" target="_blank" rel="noopener">CoinGecko</a>
        · <a href="https://finance.yahoo.com/" target="_blank" rel="noopener">Yahoo</a>
        · Headlines via public RSS (not affiliation)
      </div>
    </footer>
  `;
  scheduleSyncMoversLayout();
  pushAds();
  if (magicFocusKey) {
    const el = app.querySelector(`[data-magic="${magicFocusKey}"]`) as HTMLInputElement | null;
    if (el) {
      el.focus({ preventScroll: true });
      if (selStart != null && selEnd != null) {
        try {
          el.setSelectionRange(selStart, selEnd);
        } catch {
          /* ignore */
        }
      }
    }
  } else if (panelFocus && panelEdit) {
    const sel =
      panelFocus === 'title'
        ? '.panel-edit-title'
        : '.panel-edit-search';
    const el = app.querySelector(sel) as HTMLInputElement | null;
    if (el) {
      el.focus({ preventScroll: true });
      if (selStart != null && selEnd != null) {
        try {
          el.setSelectionRange(selStart, selEnd);
        } catch {
          /* ignore */
        }
      }
    }
  } else if (dashSearchFocused) {
    const el = app.querySelector('#dash-search-input') as HTMLInputElement | null;
    if (el) {
      el.focus({ preventScroll: true });
      if (selStart != null && selEnd != null) {
        try {
          el.setSelectionRange(selStart, selEnd);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/**
 * Sync paint for user interactions. Skips while hidden so background
 * interval bursts cannot wipe #app (blank flash on tab return).
 */
function render(): void {
  if (document.hidden) {
    renderDirty = true;
    return;
  }
  if (renderRaf) {
    cancelAnimationFrame(renderRaf);
    renderRaf = 0;
  }
  renderDirty = false;
  renderNow();
}

/** Coalesce parallel refresh completions into one DOM write per frame. */
function scheduleRender(): void {
  if (document.hidden) {
    renderDirty = true;
    return;
  }
  renderDirty = true;
  if (renderRaf) return;
  renderRaf = requestAnimationFrame(() => {
    renderRaf = 0;
    if (!renderDirty || document.hidden) return;
    renderDirty = false;
    renderNow();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function refreshCrypto(): Promise<void> {
  try {
    const rows = await fetchTopCryptos();
    state.cryptos = rows;
    state.cryptoUnavailable = !rows.some((c) => c.ok && !c.fallback);
    if (!state.cryptoUnavailable) state.cryptoAsOf = new Date();
  } catch {
    state.cryptos = state.cryptos.map((c) => ({
      ...c,
      stale: true,
      fallback: c.ok ? false : true,
    }));
    if (!state.cryptos.some((c) => c.price != null && !c.fallback)) {
      // Demo placeholders only — mark unavailable so UI does not look live.
      state.cryptos = CRYPTO_FALLBACK.map((c) => ({ ...c, stale: true, fallback: true }));
      state.cryptoUnavailable = true;
    } else {
      // Keep last good values — already marked stale above.
      state.cryptoUnavailable = false;
    }
  }
}

function applyYahooMap(map: Awaited<ReturnType<typeof fetchYahooQuotes>>): void {
  const has = (yahoo: string) => map.has(yahoo);
  const lookup = (yahoo: string) => map.get(yahoo);

  state.hero = state.heroDefs.map((d, i) => {
    if (!has(d.yahoo)) return state.hero[i]!;
    const q = toMarketQuote(d, lookup(d.yahoo), state.hero[i]);
    q.sparkline = state.hero[i]?.sparkline ?? q.sparkline ?? null;
    return q;
  });
  const prevStocks = new Map(state.stocks.map((q) => [q.symbol, q]));
  const prevEtfs = new Map(state.etfs.map((q) => [q.symbol, q]));
  state.stocks = sortByMktCapDesc(
    TOP_STOCK_SYMBOLS.map((d) => {
      if (!has(d.yahoo)) {
        return prevStocks.get(d.yahoo) ?? toMarketQuote(d, undefined);
      }
      return toMarketQuote(d, lookup(d.yahoo), prevStocks.get(d.yahoo));
    }),
  );
  state.etfs = sortByMktCapDesc(
    TOP_ETF_SYMBOLS.map((d) => {
      if (!has(d.yahoo)) {
        return prevEtfs.get(d.yahoo) ?? toMarketQuote(d, undefined);
      }
      return toMarketQuote(d, lookup(d.yahoo), prevEtfs.get(d.yahoo));
    }),
  );
  state.indexes = state.indexDefs.map((d, i) => {
    if (!has(d.yahoo)) return state.indexes[i]!;
    const q = toMarketQuote(d, lookup(d.yahoo), state.indexes[i]);
    q.sparkline = state.indexes[i]?.sparkline ?? q.sparkline ?? null;
    return q;
  });
  state.yahooAsOf = new Date();
  syncWatchQuotesFromMap(lookup);
}

let mcapFillGen = 0;

/** ETF AUM / leftover equity caps. Prices are already on screen. */
async function fillMissingMarketCaps(): Promise<void> {
  const gen = ++mcapFillGen;
  const missing = new Set<string>();
  const consider = (symbol: string, marketCap: number | null | undefined) => {
    if (!symbolWantsMarketCap(symbol)) return;
    if (marketCap == null) missing.add(symbol);
  };
  for (const q of state.stocks) consider(q.symbol, q.marketCap);
  for (const q of state.etfs) consider(q.symbol, q.marketCap);
  for (const q of state.indexes) consider(q.symbol, q.marketCap);
  for (const q of state.hero) consider(q.symbol, q.marketCap);
  for (const q of watchQuotes.values()) consider(q.symbol, q.marketCap);
  if (!missing.size) return;
  let caps: Map<string, number>;
  try {
    caps = await fetchYahooMarketCaps([...missing]);
  } catch {
    return;
  }
  if (gen !== mcapFillGen || !caps.size) return;
  const applyCap = <T extends { symbol: string; marketCap?: number | null }>(row: T): T => {
    const v = caps.get(row.symbol);
    if (v == null) return row;
    return { ...row, marketCap: v };
  };
  state.stocks = sortByMktCapDesc(state.stocks.map(applyCap));
  state.etfs = sortByMktCapDesc(state.etfs.map(applyCap));
  state.indexes = state.indexes.map(applyCap);
  state.hero = state.hero.map(applyCap);
  for (const [k, q] of watchQuotes) {
    const v = caps.get(q.symbol) ?? caps.get(k);
    if (v != null) watchQuotes.set(k, { ...q, marketCap: v });
  }
  scheduleRender();
}

async function refreshYahoo(): Promise<void> {
  const symbols = yahooSymbolsForFetch();
  try {
    const map = await fetchYahooQuotes(symbols, undefined, {
      onChunk: (partial) => {
        applyYahooMap(partial);
        scheduleRender();
      },
    });
    applyYahooMap(map);
    void fillMissingMarketCaps();
  } catch {
    state.hero = state.hero.map((q) => ({ ...q, stale: true }));
    state.stocks = state.stocks.map((q) => ({ ...q, stale: true }));
    state.etfs = state.etfs.map((q) => ({ ...q, stale: true }));
    state.indexes = state.indexes.map((q) => ({ ...q, stale: true }));
    throw new Error('yahoo failed');
  }
}

let bubbleAbort: AbortController | null = null;

async function refreshBubbles(): Promise<void> {
  if (bubbleAbort) bubbleAbort.abort();
  bubbleAbort = new AbortController();
  const signal = bubbleAbort.signal;
  const prev = state.bubbles;
  state.bubbleStatus = state.bubbles.length ? 'stale' : 'loading';
  try {
    const data = await fetchBubbles(state.bubbleCategory, state.bubbleTf, signal);
    if (signal.aborted) return;
    state.bubbleRateLimited = Boolean(data.rateLimited);
    state.bubbleTfLabel = data.tfLabel ?? state.bubbleTf;
    state.bubbleNote = data.note ?? '';
    state.bubbleLimitation = data.limitation ?? data.error ?? '';
    if (data.items?.length) {
      state.bubbles = data.items;
      state.bubbleStatus = data.stale || data.rateLimited ? 'stale' : 'ok';
    } else if (prev.length) {
      state.bubbleStatus = 'stale';
    } else {
      state.bubbles = [];
      state.bubbleStatus = 'err';
    }
  } catch (e) {
    if (signal.aborted) return;
    state.bubbleStatus = prev.length ? 'stale' : 'err';
    const msg = e instanceof Error ? e.message : 'Bubble fetch failed';
    if (msg.includes('429')) state.bubbleRateLimited = true;
    if (!state.bubbleLimitation) {
      state.bubbleLimitation = msg;
    }
  }
}

async function refreshHeroAndIndexCharts(): Promise<void> {
  const hero = state.heroDefs.map((d, i) => ({ yahoo: d.yahoo, kind: 'hero' as const, i }));
  const indexes = state.indexDefs.map((d, i) => ({ yahoo: d.yahoo, kind: 'index' as const, i }));
  const defs = [...hero, ...indexes];
  let batch = new Map<string, number[]>();
  try {
    batch = await fetchSparklineBatch(defs.map((d) => d.yahoo));
  } catch {
    batch = new Map();
  }
  const missing: typeof defs = [];
  for (const d of defs) {
    const closes = batch.get(d.yahoo);
    if (closes && closes.length > 1) {
      if (d.kind === 'hero' && state.hero[d.i]) {
        state.hero[d.i] = { ...state.hero[d.i]!, sparkline: closes };
      } else if (d.kind === 'index' && state.indexes[d.i]) {
        state.indexes[d.i] = { ...state.indexes[d.i]!, sparkline: closes };
      }
    } else {
      missing.push(d);
    }
  }
  if (missing.length) {
    await Promise.all(
      missing.map(async (d, n) => {
        try {
          await sleep(n * 40);
          const series = await fetchChartSeries(d.yahoo, '1y', '1d');
          if (!(series.ok && series.closes.length > 1)) return;
          if (d.kind === 'hero' && state.hero[d.i]) {
            state.hero[d.i] = { ...state.hero[d.i]!, sparkline: series.closes };
          } else if (d.kind === 'index' && state.indexes[d.i]) {
            state.indexes[d.i] = { ...state.indexes[d.i]!, sparkline: series.closes };
          }
        } catch {
          /* keep prior */
        }
      }),
    );
  }
}

function syncTrendingAggregateStatus(): void {
  const bothOk =
    state.trendingPumpsStatus === 'ok' && state.trendingDumpsStatus === 'ok';
  const anyStale =
    state.trendingPumpsStatus === 'stale' || state.trendingDumpsStatus === 'stale';
  const bothErr =
    state.trendingPumpsStatus === 'err' && state.trendingDumpsStatus === 'err';
  const anyLoading =
    state.trendingPumpsStatus === 'loading' ||
    state.trendingDumpsStatus === 'loading';
  state.trendingStatus = bothErr
    ? 'err'
    : anyLoading
      ? 'loading'
      : anyStale
        ? 'stale'
        : bothOk
          ? 'ok'
          : 'loading';
  state.trending = [...state.trendingPumps, ...state.trendingDumps];
}

async function refreshTrendingSide(kind: 'pumps' | 'dumps'): Promise<void> {
  await refreshPanelSide(kind === 'pumps' ? 'left' : 'right');
}

async function refreshTrending(): Promise<void> {
  const hadPumps = state.trendingPumps.length > 0;
  const hadDumps = state.trendingDumps.length > 0;
  state.trendingPumpsStatus = hadPumps ? 'stale' : 'loading';
  state.trendingDumpsStatus = hadDumps ? 'stale' : 'loading';
  state.trendingStatus = hadPumps || hadDumps ? 'stale' : 'loading';
  state.trendingRateLimited = false;
  state.trendingStale = false;
  await Promise.all([
    refreshTrendingSide('pumps'),
    refreshTrendingSide('dumps'),
  ]);
}

function applyHeadlinesPayload(
  data: Awaited<ReturnType<typeof fetchHeadlines>>,
  prev: HeadlineItem[],
  prevCat: HeadlineCategory,
): void {
  state.headlinesNote = data.note ?? '';
  state.headlinesThin = Boolean(data.thin);
  state.headlinesStale = Boolean(data.stale);
  state.headlinesFeeds = data.feedsUsed ?? [];
  if (data.items.length) {
    state.headlines = data.items;
    state.headlineSlide = Math.min(state.headlineSlide, Math.max(0, data.items.length - 1));
    state.headlinesStatus = data.thin ? 'thin' : data.stale ? 'stale' : 'ok';
    if (data.fetchedAt) {
      const t = Date.parse(data.fetchedAt);
      state.headlinesAsOf = Number.isFinite(t) ? new Date(t) : new Date();
    } else {
      state.headlinesAsOf = new Date();
    }
  } else if (prev.length && prevCat === state.headlineCategory) {
    state.headlinesStatus = 'stale';
  } else {
    state.headlines = [];
    state.headlinesStatus = 'err';
  }
}

async function refreshHeadlines(opts?: { preferCache?: boolean }): Promise<void> {
  const prev = state.headlines;
  const prevCat = state.headlineCategory;
  const cat = state.headlineCategory;
  if (opts?.preferCache) {
    const hit = headlinesPrefetch.get(cat);
    if (hit?.items?.length) {
      applyHeadlinesPayload(hit, prev, prevCat);
      return;
    }
  }
  state.headlinesStatus = prev.length && prevCat === cat ? 'stale' : 'loading';
  try {
    const data = await fetchHeadlines(cat);
    headlinesPrefetch.set(cat, data);
    if (state.headlineCategory !== prevCat) return; // superseded
    applyHeadlinesPayload(data, prev, prevCat);
  } catch (e) {
    if (state.headlineCategory !== prevCat) return;
    state.headlinesStatus = prev.length ? 'stale' : 'err';
    state.headlinesNote = e instanceof Error ? e.message : 'Headlines fetch failed';
  }
}

/** Warm other categories in the background after first load. */
async function prefetchAllHeadlineCategories(): Promise<void> {
  for (const c of HEADLINE_CATS) {
    if (c.id === state.headlineCategory && headlinesPrefetch.has(c.id)) continue;
    if (headlinesPrefetch.has(c.id)) continue;
    try {
      const data = await fetchHeadlines(c.id);
      headlinesPrefetch.set(c.id, data);
    } catch {
      /* ignore — best-effort warm */
    }
    await sleep(80);
  }
}

async function switchHeadlineCategory(cat: HeadlineCategory): Promise<void> {
  if (cat === state.headlineCategory) return;
  const token = ++headlineSwitchToken;
  const reduced = prefersReducedMotion();
  const hadCards = state.headlines.some((h) => !!h.image);

  if (!reduced && hadCards) {
    state.headlineAnim = 'exit';
    render();
    await sleep(200);
    if (token !== headlineSwitchToken) return;
  }

  state.headlineCategory = cat;
  state.headlineSlide = 0;
  state.headlines = [];
  state.headlinesNote = '';
  state.headlinesStatus = 'loading';
  state.headlineAnim = 'idle';
  render();

  const cached = headlinesPrefetch.get(cat);
  if (cached?.items?.length) {
    applyHeadlinesPayload(cached, [], cat);
  } else {
    await refreshHeadlines();
  }
  if (token !== headlineSwitchToken) return;

  if (!reduced && state.headlines.some((h) => !!h.image)) {
    state.headlineAnim = 'enter';
    render();
    await sleep(480);
    if (token !== headlineSwitchToken) return;
    state.headlineAnim = 'idle';
  }
  render();
}

async function refreshAll(opts?: { paint?: boolean }): Promise<void> {
  state.lastAttemptAt = new Date();
  let cryptoOk = false;
  let yahooOk = false;

  const cryptoP = (async () => {
    await sleep(50);
    await refreshCrypto();
    cryptoOk = state.cryptos.some((c) => c.ok && !c.fallback);
  })();

  const yahooP = (async () => {
    try {
      await refreshYahoo();
      yahooOk =
        state.hero.some((q) => q.ok) ||
        state.stocks.some((q) => q.ok) ||
        state.indexes.some((q) => q.ok);
    } catch {
      yahooOk = false;
    }
  })();

  await Promise.all([cryptoP, yahooP]);

  if (cryptoOk || yahooOk) {
    state.lastOkAt = new Date();
    state.status = cryptoOk && yahooOk ? 'ok' : 'stale';
  } else if (state.lastOkAt) {
    state.status = 'stale';
  } else {
    state.status = 'err';
  }

  if (opts?.paint !== false) scheduleRender();
}

/* ── Tooltip layer (lives outside #app so render() cannot clobber it) ── */
let tipShowTimer: ReturnType<typeof setTimeout> | null = null;
let tipHideTimer: ReturnType<typeof setTimeout> | null = null;
let tipEl: HTMLElement | null = null;
/** Once placed, rich tips stay put so links are reachable */
let tipPinned = false;
/** True while pointer is inside #tip-layer — tip must not auto-dismiss */
let tipPointerInside = false;
let tipLayerBound = false;

function ensureTipLayer(): HTMLDivElement {
  let layer = document.querySelector<HTMLDivElement>('#tip-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'tip-layer';
    layer.className = 'tip-layer';
    layer.hidden = true;
    document.body.appendChild(layer);
  }
  if (!tipLayerBound) {
    tipLayerBound = true;
    layer.addEventListener('pointerenter', () => {
      tipPointerInside = true;
      clearTipHideTimer();
    });
    layer.addEventListener('pointerleave', (e) => {
      const related = e.relatedTarget as Node | null;
      if (related && layer!.contains(related)) return;
      tipPointerInside = false;
      hideTip();
    });
  }
  return layer;
}

function clearTipShowTimer(): void {
  if (tipShowTimer) {
    clearTimeout(tipShowTimer);
    tipShowTimer = null;
  }
}

function clearTipHideTimer(): void {
  if (tipHideTimer) {
    clearTimeout(tipHideTimer);
    tipHideTimer = null;
  }
}

function hideTip(): void {
  clearTipShowTimer();
  clearTipHideTimer();
  tipPointerInside = false;
  const layer = document.querySelector<HTMLDivElement>('#tip-layer');
  if (layer) {
    layer.hidden = true;
    layer.textContent = '';
    layer.classList.remove('tip-rich');
  }
  tipEl = null;
  tipPinned = false;
}

function scheduleTipHide(ms: number): void {
  clearTipHideTimer();
  tipHideTimer = setTimeout(() => {
    tipHideTimer = null;
    // Sticky while pointer remains over the tip box
    if (tipPointerInside) return;
    const layer = document.querySelector<HTMLDivElement>('#tip-layer');
    if (layer && !layer.hidden && layer.matches(':hover')) {
      tipPointerInside = true;
      return;
    }
    hideTip();
  }, ms);
}

function placeTip(layer: HTMLDivElement, x: number, y: number): void {
  const pad = 12;
  const rect = layer.getBoundingClientRect();
  let left = x + 14;
  let top = y + 16;
  if (left + rect.width > window.innerWidth - pad) left = x - rect.width - 10;
  if (top + rect.height > window.innerHeight - pad) top = y - rect.height - 10;
  if (left < pad) left = pad;
  if (top < pad) top = pad;
  layer.style.left = `${left}px`;
  layer.style.top = `${top}px`;
}

function showTip(target: HTMLElement, x: number, y: number): void {
  const layer = ensureTipLayer();
  const html = target.getAttribute('data-tip-html');
  const text = target.getAttribute('data-tip') ?? '';
  if (!html && !text) return;
  clearTipHideTimer();
  if (html) {
    // Avoid clobbering tip DOM (and hover) if same rich content already shown
    const same =
      tipPinned &&
      tipEl === target &&
      !layer.hidden &&
      layer.classList.contains('tip-rich');
    if (!same) {
      layer.innerHTML = html;
    }
    layer.classList.add('tip-rich');
    tipPinned = true;
    // Pin near first show; do not follow cursor afterward
    if (layer.hidden || !same) {
      layer.hidden = false;
      placeTip(layer, x, y);
    } else {
      layer.hidden = false;
    }
  } else {
    layer.textContent = text;
    layer.classList.remove('tip-rich');
    tipPinned = false;
    layer.hidden = false;
    placeTip(layer, x, y);
  }
  tipEl = target;
}

document.addEventListener(
  'pointerover',
  (e) => {
    const target = e.target as HTMLElement | null;
    // Entering the tip itself — keep it open
    if (target?.closest?.('#tip-layer')) {
      tipPointerInside = true;
      clearTipHideTimer();
      return;
    }
    const t = target?.closest?.('.has-tip') as HTMLElement | null;
    if (!t) return;
    if (!t.getAttribute('data-tip') && !t.getAttribute('data-tip-html')) return;
    clearTipHideTimer();
    clearTipShowTimer();
    const cx = e.clientX;
    const cy = e.clientY;
    tipShowTimer = setTimeout(() => {
      tipShowTimer = null;
      // If user already parked on the tip, don't steal focus back to a row tip
      if (tipPointerInside) return;
      showTip(t, cx, cy);
    }, TOOLTIP_DELAY_MS);
  },
  true,
);

document.addEventListener(
  'pointermove',
  (e) => {
    if (!tipEl || tipPinned) return;
    const layer = document.querySelector<HTMLDivElement>('#tip-layer');
    if (!layer || layer.hidden) return;
    if ((e.target as HTMLElement | null)?.closest?.('#tip-layer')) return;
    placeTip(layer, e.clientX, e.clientY);
  },
  true,
);

document.addEventListener(
  'pointerout',
  (e) => {
    const related = e.relatedTarget as HTMLElement | null;
    // Moving onto the tip — cancel any pending hide
    if (related?.closest?.('#tip-layer')) {
      tipPointerInside = true;
      clearTipHideTimer();
      return;
    }
    if (tipPointerInside) return;
    if (tipEl && related && tipEl.contains(related)) return;

    const leaving = (e.target as HTMLElement | null)?.closest?.('.has-tip');
    if (leaving === tipEl) {
      // Grace window to reach founder X links in the tip
      scheduleTipHide(TIP_REACH_GRACE_MS);
      return;
    }
    // Leaving a tip target before it opened — cancel show
    if (tipShowTimer && leaving) {
      clearTipShowTimer();
    }
  },
  true,
);

// Leave the tip box → hide immediately (also handled by tip pointerleave)
document.addEventListener(
  'pointerout',
  (e) => {
    const layer = document.querySelector<HTMLDivElement>('#tip-layer');
    if (!layer || layer.hidden) return;
    const t = e.target as HTMLElement | null;
    if (!t?.closest?.('#tip-layer')) return;
    const related = e.relatedTarget as HTMLElement | null;
    if (related?.closest?.('#tip-layer')) return;
    tipPointerInside = false;
    hideTip();
  },
  true,
);

document.addEventListener(
  'scroll',
  () => {
    // Do not dismiss while the cursor is parked on a rich tip (e.g. to click X links)
    if (tipPointerInside) return;
    hideTip();
  },
  true,
);

ensureTipLayer();


/* Controls — event delegation */

app.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && panelEdit) {
    e.preventDefault();
    closePanelEditor();
    return;
  }
  if (e.key === 'Escape' && heroEdit) {
    e.preventDefault();
    closeHeroEditor();
    return;
  }
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = (e.target as HTMLElement | null)?.closest?.('tr.row-link[data-href]') as HTMLElement | null;
  if (!row) return;
  const href = row.getAttribute('data-href');
  if (!href) return;
  e.preventDefault();
  window.open(href, '_blank', 'noopener,noreferrer');
});

app.addEventListener('input', (e) => {
  const t = e.target as HTMLElement | null;
  if (t?.id === 'dash-search-input' || t?.classList?.contains('dash-search-input')) {
    scheduleDashSearch((t as HTMLInputElement).value);
    return;
  }
  if (t?.classList?.contains('panel-edit-search') && panelEdit) {
    schedulePanelEditSearch((t as HTMLInputElement).value);
    return;
  }
  if (t?.classList?.contains('hero-edit-search') && heroEdit && !t.classList.contains('panel-edit-search')) {
    scheduleHeroEditSearch((t as HTMLInputElement).value);
    return;
  }
  if (t?.classList?.contains('panel-edit-title') && panelEdit) {
    panelEdit.draft.title = (t as HTMLInputElement).value;
  }
});

app.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && panelEdit) {
    e.preventDefault();
    closePanelEditor();
    return;
  }
  if (e.key === 'Escape' && heroEdit) {
    e.preventDefault();
    closeHeroEditor();
    return;
  }
  if (e.key === 'Escape' && dashSearch.open) {
    dashSearch.open = false;
    scheduleRender();
    return;
  }
  if (
    e.key === 'Enter' &&
    (e.target as HTMLElement | null)?.id === 'dash-search-input'
  ) {
    e.preventDefault();
    const q = dashSearch.query.trim() || (e.target as HTMLInputElement).value.trim();
    if (!q) return;
    const first = dashSearch.results[0];
    void focusDashSymbol(first?.yahoo ?? q);
  }
});

app.addEventListener('change', (e) => {
  const t = e.target as HTMLElement | null;
  const panelField = t?.getAttribute?.('data-panel-field');
  if (panelField && panelEdit && t) {
    const el = t as HTMLSelectElement | HTMLInputElement;
    if (panelField === 'mode') {
      const mode = el.value as PanelMode;
      panelEdit.draft.mode = mode;
      if (mode === 'curated' && !panelEdit.assets.length) {
        panelEdit.loading = true;
        render();
        void loadPanelEditAssets(panelEdit.query);
        return;
      }
      render();
      return;
    }
    if (panelField === 'size') {
      panelEdit.draft.size = Number(el.value) === 25 ? 25 : 10;
      render();
      return;
    }
    if (panelField === 'sort') {
      panelEdit.draft.sort = el.value as PanelSort;
      render();
      return;
    }
  }
  if (t?.id === 'bubble-cat') {
    const v = (t as HTMLSelectElement).value as BubbleCategory;
    if (v !== state.bubbleCategory) {
      state.bubbleCategory = v;
      if (
        (v === 'cryptos' || v === 'solana') &&
        !CRYPTO_TFS.includes(state.bubbleTf)
      ) {
        state.bubbleTf = '24h';
      }
      state.bubbles = [];
      state.bubbleStatus = 'loading';
      resetBubbleAnimState();
      lastBubblePaintKey = '';
      void refreshBubbles().then(() => render());
    }
  }
});

app.addEventListener('click', (e) => {
  const t = e.target as HTMLElement | null;

  // Dash search / watchlist chrome
  const dashClear = t?.closest?.('[data-dash-clear]') as HTMLElement | null;
  if (dashClear) {
    e.preventDefault();
    clearDashFocus();
    return;
  }
  const dashGo = t?.closest?.('[data-dash-go]') as HTMLElement | null;
  if (dashGo) {
    e.preventDefault();
    const q = dashSearch.query.trim();
    if (!q) return;
    const first = dashSearch.results[0];
    void focusDashSymbol(first?.yahoo ?? q);
    return;
  }
  const dashPick = t?.closest?.('[data-dash-pick]') as HTMLElement | null;
  if (dashPick) {
    e.preventDefault();
    const yahoo = dashPick.getAttribute('data-dash-pick');
    if (yahoo) void focusDashSymbol(yahoo);
    return;
  }
  const dashStar = t?.closest?.('[data-dash-star]') as HTMLElement | null;
  if (dashStar) {
    e.preventDefault();
    e.stopPropagation();
    starFromAttrs(dashStar);
    return;
  }
  const watchClear = t?.closest?.('[data-watch-clear]') as HTMLElement | null;
  if (watchClear) {
    e.preventDefault();
    e.stopPropagation();
    watchlist = [];
    clearWatchlist();
    scheduleRender();
    return;
  }
  const watchRemove = t?.closest?.('[data-watch-remove]') as HTMLElement | null;
  if (watchRemove) {
    e.preventDefault();
    e.stopPropagation();
    const yahoo = watchRemove.getAttribute('data-watch-remove');
    if (yahoo) {
      watchlist = watchlist.filter((w) => w.yahoo.toUpperCase() !== yahoo.toUpperCase());
      saveWatchlist(watchlist);
      scheduleRender();
    }
    return;
  }
  const watchFocus = t?.closest?.('[data-watch-focus]') as HTMLElement | null;
  if (watchFocus && !t?.closest?.('[data-watch-remove]')) {
    e.preventDefault();
    const yahoo = watchFocus.getAttribute('data-watch-focus');
    if (yahoo) void focusDashSymbol(yahoo);
    return;
  }

  // Panel pencil
  const panelEditBtn = t?.closest?.('[data-panel-edit]') as HTMLElement | null;
  if (panelEditBtn) {
    e.preventDefault();
    e.stopPropagation();
    const side = panelEditBtn.getAttribute('data-panel-edit');
    if ((side === 'left' || side === 'right') && state.user) {
      void openPanelEditor(side);
    }
    return;
  }

  // Panel editor actions
  const panelSave = t?.closest?.('[data-panel-save]') as HTMLElement | null;
  if (panelSave) {
    e.preventDefault();
    e.stopPropagation();
    void savePanelEditor();
    return;
  }
  const panelCancel = t?.closest?.('[data-panel-cancel]') as HTMLElement | null;
  if (panelCancel) {
    e.preventDefault();
    e.stopPropagation();
    closePanelEditor();
    return;
  }
  const panelPick = t?.closest?.('[data-panel-pick]') as HTMLElement | null;
  if (panelPick && panelEdit) {
    e.preventDefault();
    e.stopPropagation();
    const yahoo = panelPick.getAttribute('data-panel-pick');
    if (yahoo) {
      const existing = panelEdit.draft.assets.findIndex(
        (a) => a.yahoo.toUpperCase() === yahoo.toUpperCase(),
      );
      if (existing >= 0) {
        panelEdit.draft.assets.splice(existing, 1);
      } else {
        const found =
          panelEdit.assets.find((a) => a.yahoo === yahoo) ??
          panelEdit.assets.find((a) => a.yahoo.toUpperCase() === yahoo.toUpperCase());
        if (found) {
          panelEdit.draft.assets.push({
            id: found.id,
            yahoo: found.yahoo,
            label: found.label,
            name: found.name,
            unit: found.unit,
          });
        }
      }
      render();
    }
    return;
  }
  const panelRemove = t?.closest?.('[data-panel-remove]') as HTMLElement | null;
  if (panelRemove && panelEdit) {
    e.preventDefault();
    e.stopPropagation();
    const yahoo = panelRemove.getAttribute('data-panel-remove');
    if (yahoo) {
      panelEdit.draft.assets = panelEdit.draft.assets.filter(
        (a) => a.yahoo.toUpperCase() !== yahoo.toUpperCase(),
      );
      render();
    }
    return;
  }

  // Tile pencil (hero / indexes) — stop navigation
  const editBtn = t?.closest?.('.tile-edit') as HTMLElement | null;
  if (editBtn) {
    e.preventDefault();
    e.stopPropagation();
    const sectionAttr = editBtn.getAttribute('data-edit-section');
    const section = sectionAttr === 'indexes' ? 'indexes' : 'hero';
    const slot = Number(editBtn.getAttribute('data-edit-slot'));
    if (Number.isFinite(slot) && state.user) {
      closePanelEditor();
      void openHeroEditor(slot, section);
    }
    return;
  }

  // Hero editor pick
  const pickBtn = t?.closest?.('[data-hero-pick]') as HTMLElement | null;
  if (pickBtn) {
    e.preventDefault();
    e.stopPropagation();
    const yahoo = pickBtn.getAttribute('data-hero-pick');
    if (yahoo) void pickHeroAsset(yahoo);
    return;
  }

  // Click outside editors closes them
  if (panelEdit && !t?.closest?.('.panel-edit-pop') && !t?.closest?.('[data-panel-edit]')) {
    closePanelEditor();
    return;
  }
  if (heroEdit && !t?.closest?.('.hero-edit-pop') && !t?.closest?.('.tile-edit')) {
    closeHeroEditor();
    return;
  }

  // Auth actions
  const authAct = t?.closest?.('[data-auth]') as HTMLElement | null;
  const authAction = authAct?.getAttribute('data-auth');
  if (authAction === 'toggle-login') {
    loginMenuOpen = !loginMenuOpen;
    render();
    return;
  }
  if (authAction === 'toggle-identity') {
    hideAuthIdentity = !hideAuthIdentity;
    try {
      localStorage.setItem(AUTH_HIDE_KEY, hideAuthIdentity ? '1' : '0');
    } catch {
      /* ignore */
    }
    render();
    return;
  }
  if (authAction === 'logout') {
    e.preventDefault();
    void (async () => {
      await logout();
      state.user = null;
      applyHeroDefs(HERO_SYMBOLS.map((d) => ({ ...d })));
      applyIndexDefs(INDEX_SYMBOLS.map((d) => ({ ...d })));
      resetPanelsToDefaults();
      closeHeroEditor();
      closePanelEditor();
      render();
      try {
        await refreshYahoo();
      } catch {
        /* ignore */
      }
      try {
        await refreshTrending();
      } catch {
        /* ignore */
      }
      render();
    })();
    return;
  }
  if (authAction === 'magic-request') {
    e.preventDefault();
    void handleMagicRequest();
    return;
  }
  if (authAction === 'magic-verify') {
    e.preventDefault();
    void handleMagicVerify();
    return;
  }
  // Table rows / bubble nodes with data-href
  const linkRow = t?.closest?.('[data-href]') as HTMLElement | null;
  if (linkRow && !t?.closest?.('a,button,select,input,label')) {
    const href = linkRow.getAttribute('data-href');
    if (href) {
      e.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
  }

  const bubbleNode = t?.closest?.('.bubble-node[data-href]') as HTMLElement | null
    ?? (t?.closest?.('.bubble-node') as HTMLElement | null);
  if (bubbleNode?.getAttribute('data-href')) {
    const href = bubbleNode.getAttribute('data-href');
    if (href) {
      e.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
  }

  const cryptoKindBtn = t?.closest?.('[data-crypto-kind]') as HTMLElement | null;
  if (cryptoKindBtn) {
    const kind = cryptoKindBtn.getAttribute('data-crypto-kind');
    if (kind === 'all' || kind === 'l1s') {
      state.cryptoKind = kind;
      render();
    }
    return;
  }

  const cryptoLimitBtn = t?.closest?.('[data-crypto-limit]') as HTMLElement | null;
  if (cryptoLimitBtn) {
    const lim = Number(cryptoLimitBtn.getAttribute('data-crypto-limit'));
    if (lim === 10 || lim === 25) {
      state.cryptoListLimit = lim;
      render();
    }
    return;
  }

  const equityKindBtn = t?.closest?.('[data-equity-kind]') as HTMLElement | null;
  if (equityKindBtn) {
    const kind = equityKindBtn.getAttribute('data-equity-kind');
    if (kind === 'stocks' || kind === 'etfs') {
      state.equityKind = kind;
      render();
    }
    return;
  }

  const equityLimitBtn = t?.closest?.('[data-equity-limit]') as HTMLElement | null;
  if (equityLimitBtn) {
    const lim = Number(equityLimitBtn.getAttribute('data-equity-limit'));
    if (lim === 10 || lim === 25) {
      state.equityListLimit = lim;
      render();
    }
    return;
  }

  const hlCatBtn = t?.closest?.('[data-hl-cat]') as HTMLElement | null;
  if (hlCatBtn) {
    const cat = hlCatBtn.getAttribute('data-hl-cat') as HeadlineCategory | null;
    if (cat && cat !== state.headlineCategory) {
      void switchHeadlineCategory(cat);
    }
    return;
  }

  const hlNav = t?.closest?.('[data-hl-nav]') as HTMLElement | null;
  if (hlNav) {
    const delta = Number(hlNav.getAttribute('data-hl-nav') || 0);
    if (state.headlines.length) {
      const n = state.headlines.length;
      state.headlineSlide = (((state.headlineSlide + delta) % n) + n) % n;
      render();
    }
    return;
  }

  const hlDot = t?.closest?.('[data-hl-slide]') as HTMLElement | null;
  if (hlDot) {
    const idx = Number(hlDot.getAttribute('data-hl-slide'));
    if (Number.isFinite(idx) && state.headlines.length) {
      state.headlineSlide = Math.max(0, Math.min(state.headlines.length - 1, idx));
      render();
    }
    return;
  }

  const btn = t?.closest?.('.tf-btn') as HTMLElement | null;
  if (!btn) return;
  const pumpsTf = btn.getAttribute('data-pumps-tf') as TrendingTf | null;
  if (pumpsTf) {
    if (pumpsTf === state.panels.left.tf) return;
    state.panels.left.tf = pumpsTf;
    state.trendingPumpsTf = pumpsTf;
    state.trendingPumpsStatus = state.trendingPumps.length ? 'stale' : 'loading';
    render();
    void (async () => {
      await refreshPanelSide('left');
      if (state.user) await savePanelsLayout(state.panels);
      render();
    })();
    return;
  }
  const dumpsTf = btn.getAttribute('data-dumps-tf') as TrendingTf | null;
  if (dumpsTf) {
    if (dumpsTf === state.panels.right.tf) return;
    state.panels.right.tf = dumpsTf;
    state.trendingDumpsTf = dumpsTf;
    state.trendingDumpsStatus = state.trendingDumps.length ? 'stale' : 'loading';
    render();
    void (async () => {
      await refreshPanelSide('right');
      if (state.user) await savePanelsLayout(state.panels);
      render();
    })();
    return;
  }
  const tf = btn.getAttribute('data-tf') as Timeframe | null;
  if (!tf || tf === state.bubbleTf) return;
  state.bubbleTf = tf;
  void refreshBubbles().then(() => render());
});






document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (!(el instanceof HTMLInputElement)) return;
  const key = el.getAttribute('data-magic');
  if (key === 'email') {
    magicUi.email = el.value;
    const btn = app.querySelector('[data-auth="magic-request"]') as HTMLButtonElement | null;
    if (btn) btn.disabled = magicUi.phase === 'sending' || !magicUi.email.includes('@');
  } else if (key === 'code') {
    const cleaned = el.value.replace(/\D/g, '').slice(0, 6);
    magicUi.code = cleaned;
    if (el.value !== cleaned) el.value = cleaned;
    const btn = app.querySelector('[data-auth="magic-verify"]') as HTMLButtonElement | null;
    if (btn) btn.disabled = magicUi.phase === 'verifying' || magicUi.code.length !== 6;
  }
});

document.addEventListener('submit', (ev) => {
  const form = (ev.target as HTMLElement | null)?.closest?.('[data-magic-form]');
  if (!form) return;
  ev.preventDefault();
  if (magicUi.phase === 'sent' || magicUi.code.length === 6) {
    void handleMagicVerify();
  } else {
    void handleMagicRequest();
  }
});

ensureAdSenseScript();
initAnalytics();
try {
  render();
} catch (err) {
  console.error('[Market Check] render failed', err);
  const el = document.getElementById('app');
  if (el) {
    el.innerHTML = `<div style="padding:24px;color:#e8edf5;font:14px system-ui">Something went wrong loading the dashboard. Try a hard refresh. If it keeps happening, tell us — <code style="color:#3dd6c6">${String((err as Error)?.message || err)}</code></div>`;
  }
}
try {
  paintTicker();
} catch (err) {
  console.error('[Market Check] ticker failed', err);
}
void (async () => {
  try {
    const initialQ = readInitialQuery();
    if (initialQ) {
      dashSearch.query = initialQ;
      dashSearch.focusedYahoo = initialQ;
      dashSearch.focusedStatus = 'loading';
    }
    // Quotes must not wait on auth — a hung /api/auth/me used to leave
    // status stuck on "Quotes loading…" even though the shell had painted.
    const authP = bootstrapAuth().catch((err) => {
      console.warn('[Market Check] auth bootstrap skipped', err);
    });
    const chartsP = refreshHeroAndIndexCharts()
      .then(() => scheduleRender())
      .catch((err) => console.warn('[Market Check] sparklines skipped', err));
    await refreshAll();
    await authP;
    render();
    if (initialQ) {
      void focusDashSymbol(initialQ, { share: true });
    } else if (watchlist.length) {
      void refreshYahooQuotesForWatch().then(() => scheduleRender());
    }
    void chartsP;
  void refreshBubbles().then(() => scheduleRender());
  void refreshTrending().then(() => scheduleRender());
  void refreshHeadlines().then(() => {
    rebuildTickerFromPrefetch();
    scheduleRender();
    void prefetchAllHeadlineCategories().then(() => {
      rebuildTickerFromPrefetch();
      scheduleRender();
    });
  });
  void refreshTicker().then(() => scheduleRender());
  } catch (err) {
    console.error('[Market Check] bootstrap failed', err);
  }
})();
setInterval(() => void refreshAll(), REFRESH_MS);
setInterval(() => void refreshHeroAndIndexCharts().then(() => scheduleRender()), CHART_REFRESH_MS);
setInterval(() => void refreshBubbles().then(() => scheduleRender()), BUBBLE_REFRESH_MS);
setInterval(() => void refreshTrending().then(() => scheduleRender()), TRENDING_REFRESH_MS);
setInterval(
  () =>
    void refreshHeadlines().then(() => {
      rebuildTickerFromPrefetch();
      scheduleRender();
    }),
  HEADLINES_REFRESH_MS,
);
setInterval(
  () =>
    void refreshTicker().then(() => scheduleRender()),
  HEADLINES_REFRESH_MS,
);

setInterval(() => {
  // Don't advance+paint while hidden — keeps last DOM for instant tab return
  if (document.hidden) return;
  if (state.headlines.length < 2) return;
  if (state.headlineAnim !== 'idle') return;
  const section = document.getElementById('headlines-section');
  // Pause while pointer is over the section (survives full re-renders)
  if (section?.matches(':hover')) return;
  state.headlineSlide = (state.headlineSlide + 1) % state.headlines.length;
  scheduleRender();
}, HEADLINE_ROTATE_MS);

setInterval(() => {
  const next = formatHalvingCountdown();
  if (next !== state.halvingText) {
    state.halvingText = next;
    const el = document.querySelector('.halving-line');
    if (el) el.textContent = next;
  }
}, 60_000);

window.addEventListener('resize', () => scheduleSyncMoversLayout({ animate: false }));

let resumeRefreshInFlight = false;

/**
 * Tab return: keep last painted DOM, resume ticker, soft-refresh in place.
 * Avoids the prior burst of parallel render() → app.innerHTML wipes (blank flash).
 */
async function resumeAfterVisible(): Promise<void> {
  resumeTickerOnVisible();
  if (renderDirty) render();
  if (resumeRefreshInFlight) return;
  resumeRefreshInFlight = true;
  try {
    await Promise.all([
      refreshAll({ paint: false }),
      refreshBubbles(),
      refreshTrending(),
      refreshHeadlines().then(() => {
        rebuildTickerFromPrefetch();
      }),
      refreshTicker(),
    ]);
    // Single in-place paint after all resume fetches — do not wipe mid-flight
    scheduleRender();
  } finally {
    resumeRefreshInFlight = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void resumeAfterVisible();
  }
});

window.addEventListener('pageshow', (ev) => {
  // bfcache restore — same soft resume, no full UI teardown
  if (ev.persisted) void resumeAfterVisible();
});

