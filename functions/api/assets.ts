/**
 * GET /api/assets?q= — searchable hero catalog + Yahoo Finance search.
 * Typing a company name (e.g. "ford") resolves real tickers (F), instead of
 * inventing an uppercase guess that often 404s on quotes.
 */

import {
  HERO_CATALOG,
  findHeroAsset,
  type HeroAssetDef,
} from '../_shared/heroCatalog';

type Ctx = { request: Request };

const UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

const YAHOO_SEARCH = 'https://query1.finance.yahoo.com/v1/finance/search';

const ALLOWED_TYPES = new Set([
  'EQUITY',
  'ETF',
  'INDEX',
  'CRYPTOCURRENCY',
  'FUTURE',
  'MUTUALFUND',
  'ECNQUOTE',
]);

function scoreMatch(a: HeroAssetDef, q: string): number {
  const yahoo = a.yahoo.toLowerCase();
  const label = a.label.toLowerCase();
  const name = (a.name ?? '').toLowerCase();
  if (yahoo === q || label === q) return 0;
  if (yahoo.startsWith(q) || label.startsWith(q)) return 1;
  if (name.startsWith(q)) return 2;
  if (yahoo.includes(q) || label.includes(q) || name.includes(q)) return 3;
  return 9;
}

function unitForSymbol(sym: string, quoteType?: string): HeroAssetDef['unit'] {
  if (sym.startsWith('^') || quoteType === 'INDEX') return 'index';
  if (/=F$/i.test(sym) && /^(GC|SI)=/i.test(sym)) return 'oz';
  if (/^CL=F$/i.test(sym)) return 'oil';
  return 'usd';
}

function fromYahooHit(hit: {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
}): HeroAssetDef | null {
  const sym = (hit.symbol ?? '').trim();
  if (!sym || sym.length > 24) return null;
  const qt = (hit.quoteType ?? '').toUpperCase();
  if (qt && !ALLOWED_TYPES.has(qt)) return null;
  // Skip option contracts and weird multi-leg symbols
  if (/\d{6}[CP]\d/.test(sym)) return null;
  const name = (hit.shortname || hit.longname || '').trim() || undefined;
  const id = `yh-${sym.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return {
    id,
    yahoo: sym,
    label: sym,
    name,
    unit: unitForSymbol(sym, qt),
  };
}

async function yahooSearch(q: string): Promise<HeroAssetDef[]> {
  try {
    const url =
      `${YAHOO_SEARCH}?q=${encodeURIComponent(q)}` +
      `&quotesCount=12&newsCount=0&listsCount=0`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      quotes?: Array<{
        symbol?: string;
        shortname?: string;
        longname?: string;
        quoteType?: string;
      }>;
    };
    const out: HeroAssetDef[] = [];
    const seen = new Set<string>();
    for (const hit of json.quotes ?? []) {
      const a = fromYahooHit(hit);
      if (!a) continue;
      const key = a.yahoo.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
    return out;
  } catch {
    return [];
  }
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const url = new URL(context.request.url);
  const qRaw = (url.searchParams.get('q') ?? '').trim();
  const q = qRaw.toLowerCase();

  let assets: HeroAssetDef[] = [...HERO_CATALOG];
  if (q) {
    assets = HERO_CATALOG.filter((a) => {
      const hay = `${a.label} ${a.name ?? ''} ${a.yahoo} ${a.id}`.toLowerCase();
      return hay.includes(q);
    });
    assets.sort((a, b) => scoreMatch(a, q) - scoreMatch(b, q) || a.label.localeCompare(b.label));

    const yahooHits = await yahooSearch(qRaw);
    const exactCatalog = assets.filter((a) => scoreMatch(a, q) <= 1);
    const exactKeys = new Set(exactCatalog.map((a) => a.yahoo.toUpperCase()));
    const yahooOrdered: HeroAssetDef[] = [];
    const yahooKeys = new Set<string>();
    for (const hit of yahooHits) {
      const key = hit.yahoo.toUpperCase();
      if (exactKeys.has(key) || yahooKeys.has(key)) continue;
      yahooKeys.add(key);
      // Keep catalog label/name when we already list this symbol
      const cat = assets.find((a) => a.yahoo.toUpperCase() === key);
      yahooOrdered.push(cat ?? hit);
    }
    const restCatalog = assets.filter((a) => {
      const key = a.yahoo.toUpperCase();
      return scoreMatch(a, q) > 1 && !exactKeys.has(key) && !yahooKeys.has(key);
    });
    assets = [...exactCatalog, ...yahooOrdered, ...restCatalog];
  } else {
    assets.sort((a, b) => a.label.localeCompare(b.label));
  }

  assets = assets.slice(0, 80);

  return new Response(JSON.stringify({ assets, total: HERO_CATALOG.length }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
