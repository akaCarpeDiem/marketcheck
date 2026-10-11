/** Full sortable tables: the 250 largest coins, the stock list and the ETF list. */
import type { CryptoTf } from '../../functions/_shared/cryptoUniverse';
import type { EquityTf } from '../../functions/_shared/equityUniverse';
import { refFromCoin, refFromEquity, stockLogo } from '../data/assets';
import { LAYER1 } from '../data/layer1';
import { crypto, equities, type Coin, type Equity } from '../data/market';
import { data, isWatched, pref, setPref, toggleWatch } from '../data/user';
import { debounce, esc, frame, html, on, render } from '../lib/dom';
import { compact, dir, pct, price } from '../lib/format';
import { icon } from '../lib/icons';
import { sparkline } from '../lib/spark';
import { Scope } from '../lib/store';
import { setQuery, type View } from '../router';
import { openAsset } from '../ui/drawer';
import { flash } from '../ui/flash';
import { toast } from '../ui/toast';
import { assetCell, rowAttrs } from './parts/rows';
import { statusNote } from './parts/tables';

type Tab = 'crypto' | 'stocks' | 'etfs';
type Sort = { key: string; dir: 1 | -1 };

const TABS: { id: Tab; label: string }[] = [
  { id: 'crypto', label: 'Crypto' },
  { id: 'stocks', label: 'Stocks' },
  { id: 'etfs', label: 'ETFs' },
];

const CRYPTO_COLS: { key: string; label: string; tf?: CryptoTf }[] = [
  { key: 'price', label: 'Price' },
  { key: '1h', label: '1h', tf: '1h' },
  { key: '24h', label: '24h', tf: '24h' },
  { key: '7d', label: '7d', tf: '7d' },
  { key: '30d', label: '30d', tf: '30d' },
  { key: '1y', label: '1y', tf: '1y' },
  { key: 'cap', label: 'Market cap' },
  { key: 'vol', label: 'Volume 24h' },
];

const EQUITY_COLS: { key: string; label: string; tf?: EquityTf }[] = [
  { key: 'price', label: 'Price' },
  { key: '24h', label: '1D', tf: '24h' },
  { key: '7d', label: '1W', tf: '7d' },
  { key: '30d', label: '1M', tf: '30d' },
  { key: 'ytd', label: 'YTD', tf: 'ytd' },
  { key: '1y', label: '1Y', tf: '1y' },
  { key: 'cap', label: 'Market cap' },
];

const th = (key: string, label: string, sort: Sort, cls = 'r'): string => {
  const on = sort.key === key;
  return `<th class="${cls} sortable${on ? ' is-sorted' : ''}" data-sort="${key}" aria-sort="${on ? (sort.dir < 0 ? 'descending' : 'ascending') : 'none'}" tabindex="0">${label}${on ? (sort.dir < 0 ? icon.arrowDown(11) : icon.arrowUp(11)) : ''}</th>`;
};

const star = (key: string): string => {
  const on = isWatched(key);
  return `<td class="star-cell"><button type="button" class="icon-btn icon-btn-sm${on ? ' is-on' : ''}" data-star="${esc(key)}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${on ? 'Remove from watchlist' : 'Add to watchlist'}" title="${on ? 'Remove from watchlist' : 'Add to watchlist'}">${on ? icon.starFill(14) : icon.star(14)}</button></td>`;
};

const chg = (v: number | null | undefined): string => `<td class="r num ${dir(v)}">${pct(v)}</td>`;

/** Compare for sorting, sending missing values to the bottom whichever way the sort runs. */
function cmp(a: number | string | null | undefined, b: number | string | null | undefined, d: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'string' || typeof b === 'string') return String(a).localeCompare(String(b)) * d;
  return (a - b) * d;
}

export const marketsView: View = {
  mount(el) {
    const scope = new Scope();
    const url = new URL(location.href);
    let tab = (url.searchParams.get('tab') ?? pref('mk.tab', 'crypto')) as Tab;
    if (!TABS.some((t) => t.id === tab)) tab = 'crypto';
    let filter = '';
    let group = 'all';
    let hideStable = pref('mk.hideStable', false);
    const sorts: Record<Tab, Sort> = {
      crypto: { key: 'rank', dir: 1 },
      stocks: { key: 'cap', dir: -1 },
      etfs: { key: 'cap', dir: -1 },
    };

    el.innerHTML = `<div class="page-head">
        <div><h1>Markets</h1><p data-sub></p></div>
        <div class="page-tools">
          <div class="seg" role="tablist" aria-label="Market" data-tabs></div>
          <label class="filter"><span class="sr-only">Filter this table</span>${icon.search(15)}<input type="search" placeholder="Filter by name or ticker" autocomplete="off" spellcheck="false" data-filter /></label>
        </div>
      </div>
      <div class="chips-row" data-groups></div>
      <div class="card mk-card">
        <div class="table-wrap mk-wrap"><table class="table mk-table"><thead></thead><tbody></tbody></table></div>
        <div class="card-foot"><span data-note></span><span data-count></span></div>
      </div>`;

    const cryptoRows = (): Coin[] => {
      const s = sorts.crypto;
      const q = filter;
      let rows = crypto.get().coins;
      if (hideStable) rows = rows.filter((c) => !c.stable && !c.wrapped);
      if (group === 'l1') rows = rows.filter((c) => LAYER1.has(c.id));
      if (q) rows = rows.filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
      const get = (c: Coin): number | string | null =>
        s.key === 'rank' ? c.rank : s.key === 'name' ? c.symbol : s.key === 'price' ? c.price : s.key === 'cap' ? c.marketCap : s.key === 'vol' ? c.volume : (c.ch[s.key as CryptoTf] ?? null);
      return [...rows].sort((a, b) => cmp(get(a), get(b), s.dir));
    };

    const equityRows = (kind: 'stock' | 'etf'): Equity[] => {
      const s = sorts[kind === 'stock' ? 'stocks' : 'etfs'];
      const q = filter;
      let rows = equities.get().items.filter((e) => e.kind === kind);
      if (group !== 'all') rows = rows.filter((e) => e.group === group);
      if (q) rows = rows.filter((e) => e.symbol.toLowerCase().includes(q) || e.name.toLowerCase().includes(q));
      const get = (e: Equity): number | string | null =>
        s.key === 'name' ? e.symbol : s.key === 'group' ? e.group : s.key === 'price' ? e.price : s.key === 'cap' ? e.marketCap : e.ch[s.key as EquityTf];
      return [...rows].sort((a, b) => cmp(get(a), get(b), s.dir));
    };

    const paint = frame(() => {
      render(
        el.querySelector('[data-tabs]'),
        TABS.map((t) => `<button type="button" class="seg-btn${t.id === tab ? ' is-on' : ''}" role="tab" aria-selected="${t.id === tab ? 'true' : 'false'}" data-tab="${t.id}">${t.label}</button>`).join(''),
      );
      const head = el.querySelector('thead')!;
      const body = el.querySelector('tbody')!;
      const sort = sorts[tab];
      let count = 0;
      let total = 0;
      if (tab === 'crypto') {
        const s = crypto.get();
        const rows = cryptoRows();
        count = rows.length;
        total = s.coins.length;
        render(
          el.querySelector('[data-groups]'),
          `<button type="button" class="chip-toggle${group === 'all' ? ' is-on' : ''}" data-group="all">All</button><button type="button" class="chip-toggle${group === 'l1' ? ' is-on' : ''}" data-group="l1">Layer 1s</button><label class="check"><input type="checkbox" data-hide-stable ${hideStable ? 'checked' : ''} /> Hide stablecoins and pegged tokens</label>`,
        );
        render(head, `<tr><th class="star-cell"><span class="sr-only">Watch</span></th>${th('rank', '#', sort, 'rank')}${th('name', 'Asset', sort, '')}${CRYPTO_COLS.map((c) => th(c.key, c.label, sort)).join('')}</tr>`);
        render(
          body,
          rows.length
            ? rows
                .map((c) => {
                  const ref = refFromCoin(c);
                  return `<tr ${rowAttrs(ref.key)}>${star(ref.key)}<td class="rank num">${c.rank}</td><td class="sticky-col">${assetCell(ref, c.image)}</td>
                    <td class="r num"><span data-flash="${ref.key}" data-v="${c.price ?? ''}">${price(c.price)}</span></td>
                    ${chg(c.ch['1h'])}${chg(c.ch['24h'])}${chg(c.ch['7d'])}${chg(c.ch['30d'])}${chg(c.ch['1y'])}
                    <td class="r num">${compact(c.marketCap)}</td><td class="r num">${compact(c.volume)}</td></tr>`;
                })
                .join('')
            : `<tr class="table-empty"><td colspan="11">${s.status === 'loading' ? 'Loading…' : filter ? 'Nothing matches that filter.' : 'Crypto prices are not available right now.'}</td></tr>`,
        );
        render(el.querySelector('[data-sub]'), 'The 250 largest cryptocurrencies by market cap. Select a column to sort, a row for details.');
        render(el.querySelector('[data-note]'), html`${statusNote(s.status, s.at, 'CoinGecko')}`);
      } else {
        const kind = tab === 'stocks' ? 'stock' : 'etf';
        const s = equities.get();
        const rows = equityRows(kind);
        count = rows.length;
        total = s.items.filter((e) => e.kind === kind).length;
        const groups = [...new Set(s.items.filter((e) => e.kind === kind).map((e) => e.group))].sort();
        if (group !== 'all' && !groups.includes(group)) group = 'all';
        render(
          el.querySelector('[data-groups]'),
          [`<button type="button" class="chip-toggle${group === 'all' ? ' is-on' : ''}" data-group="all">All</button>`, ...groups.map((g) => `<button type="button" class="chip-toggle${group === g ? ' is-on' : ''}" data-group="${esc(g)}">${esc(g)}</button>`)].join(''),
        );
        render(
          head,
          `<tr><th class="star-cell"><span class="sr-only">Watch</span></th><th class="rank">#</th>${th('name', 'Asset', sort, '')}${th('group', kind === 'stock' ? 'Sector' : 'Group', sort, 'col-group')}${EQUITY_COLS.map((c) => th(c.key, c.key === 'cap' && kind === 'etf' ? 'Assets' : c.label, sort)).join('')}<th class="r">6 weeks</th></tr>`,
        );
        render(
          body,
          rows.length
            ? rows
                .map((e, i) => {
                  const ref = refFromEquity(e);
                  return `<tr ${rowAttrs(ref.key)}>${star(ref.key)}<td class="rank num">${i + 1}</td><td class="sticky-col">${assetCell(ref, stockLogo(e.symbol))}</td>
                    <td class="col-group muted">${esc(e.group)}</td>
                    <td class="r num"><span data-flash="${ref.key}" data-v="${e.price ?? ''}">${price(e.price)}</span></td>
                    ${chg(e.ch['24h'])}${chg(e.ch['7d'])}${chg(e.ch['30d'])}${chg(e.ch.ytd)}${chg(e.ch['1y'])}
                    <td class="r num">${compact(e.marketCap)}</td>
                    <td><div class="spark-cell">${sparkline(e.spark, { w: 92, h: 28 })}</div></td></tr>`;
                })
                .join('')
            : `<tr class="table-empty"><td colspan="12">${s.status === 'loading' ? 'Loading…' : filter ? 'Nothing matches that filter.' : 'Prices are not available right now.'}</td></tr>`,
        );
        render(
          el.querySelector('[data-sub]'),
          kind === 'stock'
            ? 'More than 100 of the largest US-listed companies. Select a column to sort, a row for details.'
            : 'Fifty widely held funds: broad market, sectors, bonds, commodities and themes. Select a column to sort, a row for details.',
        );
        render(el.querySelector('[data-note]'), html`${statusNote(s.status, s.at, 'Yahoo Finance')}`);
      }
      render(el.querySelector('[data-count]'), count === total ? `${total} rows` : `${count} of ${total} rows`);
      flash(body);
    });

    const open = (key: string) => {
      if (key.startsWith('c:')) {
        const c = crypto.get().byId.get(key.slice(2));
        if (c) openAsset(refFromCoin(c));
      } else {
        const e = equities.get().bySymbol.get(key.slice(2));
        if (e) openAsset(refFromEquity(e));
      }
    };
    const setSort = (key: string) => {
      const s = sorts[tab];
      if (s.key === key) s.dir = s.dir === 1 ? -1 : 1;
      else sorts[tab] = { key, dir: key === 'name' || key === 'group' || key === 'rank' ? 1 : -1 };
      paint();
    };

    scope.add(
      crypto.subscribe(paint),
      equities.subscribe(paint),
      data.subscribe(paint),
      on(el, 'click', '[data-tab]', (_e, t) => {
        tab = t.dataset.tab as Tab;
        group = 'all';
        setPref('mk.tab', tab);
        setQuery({ tab }, { replace: true });
        paint();
      }),
      on(el, 'click', '[data-group]', (_e, t) => {
        group = t.dataset.group!;
        paint();
      }),
      on(el, 'change', '[data-hide-stable]', (_e, t) => {
        hideStable = (t as HTMLInputElement).checked;
        setPref('mk.hideStable', hideStable);
        paint();
      }),
      on(el, 'click', '[data-sort]', (_e, t) => setSort(t.dataset.sort!)),
      on(el, 'keydown', '[data-sort]', (ev, t) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          setSort(t.dataset.sort!);
        }
      }),
      on(el, 'click', '[data-star]', (ev, t) => {
        ev.stopPropagation();
        const key = t.dataset.star!;
        const ref = key.startsWith('c:') ? crypto.get().byId.get(key.slice(2)) : equities.get().bySymbol.get(key.slice(2));
        if (!ref) return;
        const res = toggleWatch('id' in ref ? refFromCoin(ref) : refFromEquity(ref));
        if (res === 'full') toast('Your watchlist is full.', 'bad');
      }),
      on(el, 'click', '[data-asset]', (ev, row) => {
        if ((ev.target as Element).closest('[data-star]')) return;
        open(row.dataset.asset!);
      }),
      on(el, 'keydown', '[data-asset]', (ev, row) => {
        if ((ev.target as Element).closest('[data-star]')) return;
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          open(row.dataset.asset!);
        }
      }),
    );
    const input = el.querySelector<HTMLInputElement>('[data-filter]')!;
    input.addEventListener(
      'input',
      debounce(() => {
        filter = input.value.trim().toLowerCase();
        paint();
      }, 120),
    );
    scope.interval(paint, 30_000);
    paint();
    return () => scope.dispose();
  },
};
