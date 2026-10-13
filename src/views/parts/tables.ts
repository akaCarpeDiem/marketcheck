/** The two market tables on the overview: top crypto and top stocks / ETFs. */
import type { CryptoTf } from '../../../functions/_shared/cryptoUniverse';
import { refFromCoin, refFromEquity, stockLogo } from '../../data/assets';
import { LAYER1 } from '../../data/layer1';
import { LAYER2 } from '../../data/layer2';
import { crypto, equities, type Coin, type Equity } from '../../data/market';
import { pref, setPref } from '../../data/user';
import { frame, html, on, render } from '../../lib/dom';
import { ago, compact, price } from '../../lib/format';
import { icon } from '../../lib/icons';
import { sparkline } from '../../lib/spark';
import type { Scope } from '../../lib/store';
import { openAsset } from '../../ui/drawer';
import { flash } from '../../ui/flash';
import { assetCell, changeCell, rowAttrs } from './rows';

const seg = (name: string, options: [string, string][], value: string): string =>
  `<div class="seg" role="group">${options
    .map(([v, label]) => `<button type="button" class="seg-btn${v === value ? ' is-on' : ''}" data-set="${name}" data-value="${v}" aria-pressed="${v === value ? 'true' : 'false'}">${label}</button>`)
    .join('')}</div>`;

const skeletonRows = (n: number, cols: number): string =>
  Array.from({ length: n }, () => `<tr class="is-loading">${Array.from({ length: cols }, (_, i) => `<td${i > 1 ? ' class="r"' : ''}><span class="sk">${i === 1 ? 'Asset name' : '000.00'}</span></td>`).join('')}</tr>`).join('');

export function statusNote(status: string, at: number, source: string): string {
  if (status === 'loading') return `Loading from ${source}…`;
  if (status === 'error') return `${source} is not answering right now.`;
  const when = at ? ago(at) : '';
  return status === 'stale' ? `${source} · last good update ${when}` : `${source} · updated ${when}`;
}

function cryptoRows(coins: Coin[], tf: CryptoTf): string {
  return coins
    .map((c, i) => {
      const ref = refFromCoin(c);
      return `<tr ${rowAttrs(ref.key)}>
        <td class="rank num">${i + 1}</td>
        <td>${assetCell(ref, c.image)}</td>
        <td class="r num"><span data-flash="${ref.key}" data-v="${c.price ?? ''}">${price(c.price)}</span></td>
        ${changeCell(c.ch['24h'])}
        ${changeCell(c.ch[tf], 'col-wide')}
        <td class="r num col-mid">${compact(c.marketCap)}</td>
      </tr>`;
    })
    .join('');
}

function equityRows(items: Equity[]): string {
  return items
    .map((e, i) => {
      const ref = refFromEquity(e);
      return `<tr ${rowAttrs(ref.key)}>
        <td class="rank num">${i + 1}</td>
        <td>${assetCell(ref, stockLogo(e.symbol))}</td>
        <td class="r num"><span data-flash="${ref.key}" data-v="${e.price ?? ''}">${price(e.price)}</span></td>
        ${changeCell(e.ch['24h'])}
        <td class="r num col-mid">${compact(e.marketCap)}</td>
        <td class="col-wide"><div class="spark-cell">${sparkline(e.spark, { w: 92, h: 28 })}</div></td>
      </tr>`;
    })
    .join('');
}

export function mountTables(cryptoEl: HTMLElement, equityEl: HTMLElement, scope: Scope): void {
  let cryptoKind = pref('ov.cryptoKind', 'all');
  let cryptoN = pref('ov.cryptoN', 10);
  let equityKind = pref('ov.equityKind', 'stock');
  let equityN = pref('ov.equityN', 10);

  cryptoEl.innerHTML = `<div class="card-head">
      <h2 class="card-title">${icon.chart(16)} Crypto <span class="card-sub" data-sub></span></h2>
      <div class="card-tools" data-tools></div>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>#</th><th>Asset</th><th class="r">Price</th><th class="r">24h</th><th class="r col-wide">7d</th><th class="r col-mid">Market cap</th></tr></thead>
      <tbody></tbody>
    </table></div>
    <div class="card-foot"><span data-note></span><a href="/markets/">All 250 coins ${icon.chevronRight(13)}</a></div>`;
  equityEl.innerHTML = `<div class="card-head">
      <h2 class="card-title">${icon.chart(16)} <span data-title>US stocks</span> <span class="card-sub" data-sub></span></h2>
      <div class="card-tools" data-tools></div>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>#</th><th>Asset</th><th class="r">Price</th><th class="r">Today</th><th class="r col-mid" data-cap>Market cap</th><th class="r col-wide">6 weeks</th></tr></thead>
      <tbody></tbody>
    </table></div>
    <div class="card-foot"><span data-note></span><a href="/markets/?tab=stocks" data-more>All stocks and ETFs ${icon.chevronRight(13)}</a></div>`;

  const paintCrypto = frame(() => {
    const s = crypto.get();
    render(
      cryptoEl.querySelector('[data-tools]'),
      seg('cryptoKind', [['all', 'All'], ['l1', 'Layer 1s'], ['l2', 'Layer 2s']], cryptoKind) + seg('cryptoN', [['10', 'Top 10'], ['25', 'Top 25']], String(cryptoN)),
    );
    const pool = cryptoKind === 'l1' ? s.coins.filter((c) => LAYER1.has(c.id)) : cryptoKind === 'l2' ? s.coins.filter((c) => LAYER2.has(c.id)) : s.coins;
    const rows = pool.slice(0, cryptoN);
    render(cryptoEl.querySelector('[data-sub]'), cryptoKind === 'l1' ? 'layer-1 networks by market cap' : cryptoKind === 'l2' ? 'layer-2 networks by market cap' : 'by market cap');
    render(
      cryptoEl.querySelector('tbody'),
      rows.length
        ? cryptoRows(rows, '7d')
        : s.status === 'loading'
          ? skeletonRows(cryptoN, 6)
          : `<tr class="table-empty"><td colspan="6">Crypto prices are not available right now. They will appear here as soon as the data source answers.</td></tr>`,
    );
    render(cryptoEl.querySelector('[data-note]'), html`${statusNote(s.status, s.at, 'CoinGecko')}`);
    flash(cryptoEl);
  });

  const paintEquity = frame(() => {
    const s = equities.get();
    render(
      equityEl.querySelector('[data-tools]'),
      seg('equityKind', [['stock', 'Stocks'], ['etf', 'ETFs']], equityKind) + seg('equityN', [['10', 'Top 10'], ['25', 'Top 25']], String(equityN)),
    );
    const rows = s.items
      .filter((e) => e.kind === equityKind && e.ok)
      .sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1))
      .slice(0, equityN);
    render(equityEl.querySelector('[data-title]'), equityKind === 'etf' ? 'ETFs' : 'US stocks');
    render(equityEl.querySelector('[data-sub]'), equityKind === 'etf' ? 'largest funds by assets' : 'largest by market cap');
    render(equityEl.querySelector('[data-cap]'), equityKind === 'etf' ? 'Assets' : 'Market cap');
    render(
      equityEl.querySelector('tbody'),
      rows.length
        ? equityRows(rows)
        : s.status === 'loading'
          ? skeletonRows(equityN, 6)
          : `<tr class="table-empty"><td colspan="6">Stock prices are not available right now. They will appear here as soon as the data source answers.</td></tr>`,
    );
    equityEl.querySelector<HTMLAnchorElement>('[data-more]')?.setAttribute('href', `/markets/?tab=${equityKind === 'etf' ? 'etfs' : 'stocks'}`);
    render(equityEl.querySelector('[data-note]'), html`${statusNote(s.status, s.at, 'Yahoo Finance')}`);
    flash(equityEl);
  });

  const onSet = (_ev: Event, el: HTMLElement) => {
    const { set, value } = el.dataset;
    if (set === 'cryptoKind') setPref('ov.cryptoKind', (cryptoKind = value!));
    if (set === 'cryptoN') setPref('ov.cryptoN', (cryptoN = Number(value)));
    if (set === 'equityKind') setPref('ov.equityKind', (equityKind = value!));
    if (set === 'equityN') setPref('ov.equityN', (equityN = Number(value)));
    paintCrypto();
    paintEquity();
  };
  const open = (key: string) => {
    if (key.startsWith('c:')) {
      const c = crypto.get().byId.get(key.slice(2));
      if (c) openAsset(refFromCoin(c));
    } else {
      const e = equities.get().bySymbol.get(key.slice(2));
      if (e) openAsset(refFromEquity(e));
    }
  };
  for (const el of [cryptoEl, equityEl]) {
    scope.add(
      on(el, 'click', '[data-set]', onSet),
      on(el, 'click', '[data-asset]', (_ev, row) => open(row.dataset.asset!)),
      on(el, 'keydown', '[data-asset]', (ev, row) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          open(row.dataset.asset!);
        }
      }),
    );
  }
  scope.add(crypto.subscribe(paintCrypto), equities.subscribe(paintEquity));
  scope.interval(() => {
    paintCrypto();
    paintEquity();
  }, 30_000);
  paintCrypto();
  paintEquity();
}
