/**
 * Movers for the bubble map, the heat map and the movers panels, cut from the
 * crypto and equity universes already in memory (so changing the timeframe is
 * instant and costs no request). Solana tokens come from /api/bubbles.
 */
import { cryptoTf, isMoverCandidate, type CryptoTf } from '../../functions/_shared/cryptoUniverse';
import { equityTf, type EquityTf } from '../../functions/_shared/equityUniverse';
import { getJson } from '../lib/api';
import { esc } from '../lib/dom';
import { compact, dir, pct, price as fmtPrice } from '../lib/format';
import { signal } from '../lib/store';
import { refFromCoin, refFromEquity, stockLogo, type AssetRef } from './assets';
import { crypto, equities, eth, type Status } from './market';

export type MoverCat = 'cryptos' | 'solana' | 'ethereum' | 'stocks' | 'etfs';

export const MOVER_CATS: { id: MoverCat; label: string }[] = [
  { id: 'cryptos', label: 'Crypto' },
  { id: 'stocks', label: 'Stocks' },
  { id: 'etfs', label: 'ETFs' },
  { id: 'solana', label: 'Solana' },
  { id: 'ethereum', label: 'Ethereum' },
];

export type TfOption = { id: string; label: string };

export const CRYPTO_TFS: TfOption[] = [
  { id: '1h', label: '1h' },
  { id: '4h', label: '4h' },
  { id: '8h', label: '8h' },
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
];
const EQUITY_TFS: TfOption[] = [
  { id: '24h', label: '1D' },
  { id: '7d', label: '1W' },
  { id: '30d', label: '1M' },
  { id: 'ytd', label: 'YTD' },
  { id: '1y', label: '1Y' },
];
const SOLANA_TFS: TfOption[] = [
  { id: '1h', label: '1h' },
  { id: '6h', label: '6h' },
  { id: '24h', label: '24h' },
];

export function tfOptions(cat: MoverCat): TfOption[] {
  return cat === 'cryptos' || cat === 'ethereum' ? CRYPTO_TFS : cat === 'solana' ? SOLANA_TFS : EQUITY_TFS;
}

/** The timeframe actually used for a category when asked for `tf`. */
export function effectiveTf(cat: MoverCat, tf: string): string {
  if (cat === 'cryptos' || cat === 'ethereum') {
    const eff = cryptoTf(tf);
    return eff === '1y' ? '30d' : eff;
  }
  if (cat === 'solana') return tf === '1h' ? '1h' : tf === '6h' || tf === '4h' || tf === '8h' || tf === '12h' ? '6h' : '24h';
  return equityTf(tf);
}

export const tfLabel = (cat: MoverCat, tf: string): string =>
  tfOptions(cat).find((o) => o.id === effectiveTf(cat, tf))?.label ?? tf;

export type Mover = {
  key: string;
  /** Null for Solana tokens, which have no asset sheet. */
  ref: AssetRef | null;
  sym: string;
  name: string;
  image: string | null;
  price: number | null;
  change: number | null;
  marketCap: number | null;
  volume: number | null;
  /** Where a click goes when there is no asset sheet. */
  href?: string;
};

type SolanaPayload = {
  items?: Array<{
    id: string;
    symbol: string;
    name: string;
    image: string | null;
    price: number | null;
    changePercent: number | null;
    volume: number | null;
    marketCap: number | null;
  }>;
  stale?: boolean;
  limitation?: string;
};

type SolanaState = { items: Mover[]; at: number; status: Status };
/** Solana movers by timeframe. */
export const solana = signal<Map<string, SolanaState>>(new Map());
const solanaBusy = new Map<string, Promise<void>>();

export function loadSolana(tf: string): Promise<void> {
  const eff = effectiveTf('solana', tf);
  const have = solana.get().get(eff);
  if (have && have.status !== 'error' && Date.now() - have.at < 120_000) return Promise.resolve();
  const running = solanaBusy.get(eff);
  if (running) return running;
  const put = (s: SolanaState) => {
    const next = new Map(solana.get());
    next.set(eff, s);
    solana.set(next);
  };
  if (!have) put({ items: [], at: 0, status: 'loading' });
  const job = (async () => {
    try {
      const d = await getJson<SolanaPayload>(`/api/bubbles?category=solana&tf=${eff}&limit=60`, { timeout: 25_000 });
      const items: Mover[] = (d.items ?? []).map((t) => ({
        key: t.id,
        ref: null,
        sym: t.symbol,
        name: t.name,
        image: t.image && /^(https:\/\/|\/)/.test(t.image) ? t.image : null,
        price: t.price,
        change: t.changePercent,
        marketCap: t.marketCap,
        volume: t.volume,
        href: `https://birdeye.so/token/${encodeURIComponent(t.id.replace(/^solana:/, ''))}?chain=solana`,
      }));
      put({ items, at: Date.now(), status: items.length ? (d.stale ? 'stale' : 'ok') : 'error' });
    } catch {
      put(have?.items.length ? { ...have, status: 'stale' } : { items: [], at: Date.now(), status: 'error' });
    } finally {
      solanaBusy.delete(eff);
    }
  })();
  solanaBusy.set(eff, job);
  return job;
}

export type Pool = {
  items: Mover[];
  status: Status;
  at: number;
  /** True when the list is loaded but this window (4h, 8h) has no price history yet. */
  noHistory?: boolean;
};

/** Everything in a category that can be ranked, with its change over `tf`. */
export function moverPool(cat: MoverCat, tf: string): Pool {
  if (cat === 'cryptos' || cat === 'ethereum') {
    const eff = effectiveTf(cat, tf) as CryptoTf;
    const s = cat === 'ethereum' ? eth.get() : crypto.get();
    const items: Mover[] = [];
    let liquid = 0;
    for (const c of s.coins) {
      if (!isMoverCandidate(c)) continue;
      liquid += 1;
      const change = c.ch[eff];
      if (change == null) continue;
      items.push({ key: `c:${c.id}`, ref: refFromCoin(c), sym: c.symbol, name: c.name, image: c.image, price: c.price, change, marketCap: c.marketCap, volume: c.volume });
    }
    const intraday = eff === '4h' || eff === '8h';
    return { items, status: s.status, at: s.at, noHistory: intraday && liquid > 0 && items.length === 0 };
  }
  if (cat === 'solana') {
    const s = solana.get().get(effectiveTf('solana', tf));
    return { items: s?.items ?? [], status: s?.status ?? 'loading', at: s?.at ?? 0 };
  }
  const eff = equityTf(tf) as EquityTf;
  const kind = cat === 'stocks' ? 'stock' : 'etf';
  const s = equities.get();
  const items: Mover[] = [];
  for (const e of s.items) {
    if (e.kind !== kind || !e.ok || e.ch[eff] == null) continue;
    items.push({ key: `y:${e.symbol}`, ref: refFromEquity(e), sym: e.symbol, name: e.name, image: stockLogo(e.symbol), price: e.price, change: e.ch[eff], marketCap: e.marketCap, volume: null });
  }
  return { items, status: s.status, at: s.at };
}

/** The `limit` biggest moves in either direction. */
export function biggestMoves(cat: MoverCat, tf: string, limit: number): Pool {
  const pool = moverPool(cat, tf);
  const items = [...pool.items].sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0)).slice(0, limit);
  return { ...pool, items };
}

/** The hover card for a mover. */
export function moverTip(m: Mover, label: string): string {
  const rows = [
    `<div class="tip-row"><span>Price</span><b class="num">${fmtPrice(m.price)}</b></div>`,
    `<div class="tip-row"><span>${esc(label)}</span><b class="num ${dir(m.change)}">${pct(m.change)}</b></div>`,
  ];
  if (m.marketCap != null) rows.push(`<div class="tip-row"><span>Market cap</span><b class="num">${compact(m.marketCap)}</b></div>`);
  if (m.volume != null) rows.push(`<div class="tip-row"><span>Volume</span><b class="num">${compact(m.volume)}</b></div>`);
  return `<div class="tip-head"><strong>${esc(m.sym)}</strong><span>${esc(m.name)}</span></div>${rows.join('')}`;
}

/** What to say when a 4h or 8h view has nothing because the price record is too short. */
export const noHistoryText = (tf: string): string =>
  `${tf} changes are worked out from the site's own hourly price record, and it does not go back ${tf === '8h' ? 'eight' : 'four'} hours yet. Try 1h or 24h for now.`;
