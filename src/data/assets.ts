/**
 * One way to look at anything with a price. An AssetRef points at a Yahoo
 * symbol or a CoinGecko coin; lookup() finds its current price in whichever
 * feed has it.
 */
import type { HeroAssetDef } from '../../functions/_shared/heroCatalog';
import type { AssetKind, AssetRef } from '../../functions/_shared/userData';
import { esc } from '../lib/dom';
import { level, price as fmtPrice } from '../lib/format';
import { crypto, equities, quotes, type Coin, type Equity } from './market';

export type { AssetKind, AssetRef };

export function kindOfYahoo(symbol: string): AssetKind {
  const s = symbol.toUpperCase();
  if (s.startsWith('^')) return 'index';
  if (s.endsWith('=F')) return 'future';
  if (s.endsWith('=X') || s === 'DX-Y.NYB') return 'fx';
  if (/-USD$/.test(s)) return 'crypto';
  const e = equities.get().bySymbol.get(s);
  if (e) return e.kind;
  return 'stock';
}

export function refFromYahoo(symbol: string, sym?: string, name?: string, kind?: AssetKind): AssetRef {
  const yahoo = symbol.trim();
  const k = kind ?? kindOfYahoo(yahoo);
  const label = sym || (k === 'crypto' ? yahoo.replace(/-USD$/i, '') : yahoo.replace(/^\^/, ''));
  return { key: `y:${yahoo.toUpperCase()}`, sym: label, name: name || label, kind: k, yahoo };
}

export function refFromCoin(c: Coin): AssetRef {
  return { key: `c:${c.id}`, sym: c.symbol, name: c.name, kind: 'crypto', cg: c.id };
}

export function refFromEquity(e: Equity): AssetRef {
  return { key: `y:${e.symbol}`, sym: e.symbol, name: e.name, kind: e.kind, yahoo: e.symbol };
}

/** Tile and panel layouts store assets as HeroAssetDef. A CoinGecko coin is marked by an id of "cg:<coin id>". */
export function refFromHero(d: HeroAssetDef): AssetRef {
  const label = d.label.replace(/-USD$/i, '');
  if (d.id.startsWith('cg:')) {
    const cg = d.id.slice(3);
    return { key: `c:${cg}`, sym: label, name: d.name || label, kind: 'crypto', cg };
  }
  return refFromYahoo(d.yahoo, label, d.name);
}

/** The stored form of an asset for a tile or a curated panel. */
export function heroFromRef(ref: AssetRef): HeroAssetDef {
  if (ref.cg) {
    return { id: `cg:${ref.cg}`, yahoo: `${ref.sym.toUpperCase()}-USD`, label: ref.sym, name: ref.name, unit: 'usd' };
  }
  const yahoo = ref.yahoo ?? ref.sym;
  const u = unitOf(ref);
  return {
    id: `yh-${yahoo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    yahoo,
    label: ref.sym,
    name: ref.name,
    unit: u === 'oz' ? 'oz' : u === 'bbl' ? 'oil' : u === 'index' || u === 'pct' || u === 'rate' ? 'index' : 'usd',
  };
}

/**
 * The coin a Yahoo crypto pair (BTC-USD) refers to, when it is in the crypto
 * feed. Tickers are not unique, so a match outside the top 60 must also agree
 * on price with the Yahoo quote.
 */
export function coinForPair(yahoo: string): Coin | null {
  const m = yahoo.toUpperCase().match(/^([A-Z0-9]+)-USD$/);
  if (!m) return null;
  const coin = crypto.get().bySymbol.get(m[1]!);
  if (!coin || coin.price == null) return null;
  if (coin.rank <= 60) return coin;
  const q = quotes.get().get(yahoo);
  if (q?.price != null && Math.abs(q.price / coin.price - 1) < 0.05) return coin;
  return null;
}

/** How a price is written for a symbol: with $, per ounce, as an index level… */
export type Unit = 'usd' | 'oz' | 'bbl' | 'lb' | 'mmbtu' | 'index' | 'pct' | 'rate';

export function unitOf(ref: AssetRef): Unit {
  const y = (ref.yahoo ?? '').toUpperCase();
  if (!y) return 'usd';
  if (y === '^TNX' || y === '^IRX' || y === '^FVX' || y === '^TYX') return 'pct';
  if (y.startsWith('^') || y === 'DX-Y.NYB') return 'index';
  if (/^(GC|SI|PL|PA)=F$/.test(y)) return 'oz';
  if (/^(CL|BZ)=F$/.test(y)) return 'bbl';
  if (y === 'HG=F') return 'lb';
  if (y === 'NG=F') return 'mmbtu';
  if (y.endsWith('=X')) return 'rate';
  return 'usd';
}

const UNIT_SUFFIX: Partial<Record<Unit, string>> = { oz: '/oz', bbl: '/bbl', lb: '/lb', mmbtu: '/MMBtu' };

/** Price text for an asset, without the unit suffix. */
export function priceText(ref: AssetRef, value: number | null | undefined): string {
  const u = unitOf(ref);
  if (value == null || !Number.isFinite(value)) return '—';
  if (u === 'index') return level(value);
  if (u === 'pct') return `${value.toFixed(3)}%`;
  if (u === 'rate') return value.toFixed(4);
  return fmtPrice(value);
}

/** "/oz", "/bbl"… or an empty string. */
export const unitSuffix = (ref: AssetRef): string => UNIT_SUFFIX[unitOf(ref)] ?? '';

export type Priced = {
  ref: AssetRef;
  price: number | null;
  /** Day change in percent (rolling 24h for coins). */
  change: number | null;
  prevClose: number | null;
  marketCap: number | null;
  image: string | null;
  ok: boolean;
  stale: boolean;
  /** Where the price came from. */
  source: 'CoinGecko' | 'Yahoo Finance';
  coin?: Coin;
  equity?: Equity;
};

const FMP_LOGO = 'https://images.financialmodelingprep.com/symbol';

/** Company or fund logo for a US-listed symbol (free image CDN; may be missing). */
export const stockLogo = (symbol: string): string => `${FMP_LOGO}/${encodeURIComponent(symbol)}.png`;

function fromCoin(ref: AssetRef, c: Coin, stale: boolean): Priced {
  const ch = c.ch['24h'];
  return {
    ref,
    price: c.price,
    change: ch,
    prevClose: c.price != null && ch != null ? c.price / (1 + ch / 100) : null,
    marketCap: c.marketCap,
    image: c.image,
    ok: c.price != null,
    stale,
    source: 'CoinGecko',
    coin: c,
  };
}

/** Current price for an asset, from whichever feed carries it. */
export function lookup(ref: AssetRef): Priced {
  const cs = crypto.get();
  if (ref.cg) {
    const c = cs.byId.get(ref.cg);
    if (c) return fromCoin(ref, c, cs.status !== 'ok');
    return { ref, price: null, change: null, prevClose: null, marketCap: null, image: null, ok: false, stale: false, source: 'CoinGecko' };
  }
  const y = ref.yahoo ?? '';
  const es = equities.get();
  const e = es.bySymbol.get(y);
  if (e?.ok) {
    return {
      ref,
      price: e.price,
      change: e.ch['24h'],
      prevClose: e.prevClose,
      marketCap: e.marketCap,
      image: stockLogo(y),
      ok: true,
      stale: es.status !== 'ok',
      source: 'Yahoo Finance',
      equity: e,
    };
  }
  if (ref.kind === 'crypto') {
    const c = coinForPair(y);
    if (c) return fromCoin(ref, c, cs.status !== 'ok');
  }
  const q = quotes.get().get(y);
  const logo = ref.kind === 'stock' || ref.kind === 'etf' ? stockLogo(y) : null;
  if (q?.price != null) {
    return {
      ref,
      price: q.price,
      change: q.changePercent,
      prevClose: q.prevClose,
      marketCap: q.marketCap,
      image: logo,
      ok: true,
      stale: !!q.stale,
      source: 'Yahoo Finance',
    };
  }
  return { ref, price: null, change: null, prevClose: null, marketCap: null, image: logo, ok: false, stale: false, source: 'Yahoo Finance' };
}

/** Yahoo symbols that need their own quote request for a list of assets. */
export function yahooSymbols(refs: AssetRef[]): string[] {
  const out: string[] = [];
  for (const r of refs) if (r.yahoo && !r.cg) out.push(r.yahoo);
  return out;
}

function hue(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

const KIND_GLYPH: Partial<Record<AssetKind, string>> = { index: '∑', future: 'ƒ', fx: '¤' };

/**
 * A round logo: the image when there is one, with the ticker's initials
 * underneath so a missing or blocked image leaves a tidy placeholder.
 */
export function avatar(ref: AssetRef, image: string | null | undefined, size = 22): string {
  const text = KIND_GLYPH[ref.kind] && !image ? ref.sym.slice(0, 1) : ref.sym.replace(/[^A-Za-z0-9]/g, '').slice(0, size >= 28 ? 3 : 2) || '?';
  const img = image
    ? `<img src="${esc(image)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="this.classList.add('ok')" onerror="this.remove()" />`
    : '';
  return `<span class="avatar" style="--s:${size}px;--h:${hue(ref.sym)}" aria-hidden="true"><b>${esc(text)}</b>${img}</span>`;
}

/** Kind as a short tag for search results and lists. */
export const KIND_LABEL: Record<AssetKind, string> = {
  stock: 'Stock',
  etf: 'ETF',
  index: 'Index',
  future: 'Futures',
  fx: 'FX',
  crypto: 'Crypto',
};

/** External pages for an asset, most useful first. */
export function externalLinks(ref: AssetRef): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  if (ref.cg) {
    out.push({ label: 'CoinGecko', href: `https://www.coingecko.com/en/coins/${encodeURIComponent(ref.cg)}` });
    out.push({ label: 'Birdeye', href: `https://birdeye.so/find?address=${encodeURIComponent(ref.sym)}` });
    return out;
  }
  const y = ref.yahoo ?? ref.sym;
  if (ref.kind === 'stock' || ref.kind === 'etf') {
    out.push({ label: 'Robinhood', href: `https://robinhood.com/stocks/${encodeURIComponent(y.toUpperCase())}` });
  }
  out.push({ label: 'Yahoo Finance', href: `https://finance.yahoo.com/quote/${encodeURIComponent(y)}` });
  if (ref.kind === 'crypto') {
    const c = coinForPair(y);
    if (c) out.push({ label: 'CoinGecko', href: `https://www.coingecko.com/en/coins/${encodeURIComponent(c.id)}` });
  }
  return out;
}
