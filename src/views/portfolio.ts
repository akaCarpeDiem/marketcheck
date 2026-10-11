/** Portfolio and watchlist: what the visitor holds and follows, with live value and change. */
import { MAX_HOLDINGS, MAX_WATCH } from '../../functions/_shared/userData';
import { KIND_LABEL, lookup, priceText, type AssetRef } from '../data/assets';
import { crypto, equities, quotes, sparks, wantQuotes, wantSparks, weekChanges } from '../data/market';
import { portfolioSummary, type PortfolioSummary } from '../data/portfolio';
import { data, isWatched, syncState, toggleWatch, user } from '../data/user';
import { esc, frame, html, on, raw, render } from '../lib/dom';
import { compact, dir, money, pct, plural, quantity, signedMoney } from '../lib/format';
import { icon } from '../lib/icons';
import { Scope } from '../lib/store';
import type { View } from '../router';
import { openAuth } from '../ui/auth';
import { openAsset } from '../ui/drawer';
import { flash } from '../ui/flash';
import { openHoldingForm } from '../ui/holding';
import { openSearch } from '../ui/search';
import { toast } from '../ui/toast';
import { assetCell, rowAttrs } from './parts/rows';

const PALETTE = ['var(--brand)', '#8b7cf6', 'var(--warn)', '#f472b6', 'var(--up)', '#60a5fa', '#fb923c', 'var(--flat)'];

/** A ring chart of portfolio weights: the seven largest holdings, then everything else together. */
function donut(pf: PortfolioSummary): string {
  const rows = pf.rows.filter((r) => r.weight > 0);
  if (!rows.length) return '';
  const top = rows.slice(0, 7);
  const rest = rows.slice(7).reduce((s, r) => s + r.weight, 0);
  const parts = top.map((r, i) => ({ label: r.holding.ref.sym, weight: r.weight, colour: PALETTE[i]! }));
  if (rest > 0.0005) parts.push({ label: `${rows.length - 7} more`, weight: rest, colour: PALETTE[7]! });
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = parts
    .map((p) => {
      const len = p.weight * C;
      const arc = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${p.colour}" stroke-width="14" stroke-dasharray="${Math.max(0, len - 1.5).toFixed(2)} ${(C - Math.max(0, len - 1.5)).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" />`;
      offset += len;
      return arc;
    })
    .join('');
  const legend = parts
    .map((p) => `<li><i style="background:${p.colour}"></i><span>${esc(p.label)}</span><b class="num">${(p.weight * 100).toFixed(p.weight < 0.1 ? 1 : 0)}%</b></li>`)
    .join('');
  return `<div class="donut"><svg viewBox="0 0 120 120" role="img" aria-label="Portfolio weights"><g transform="rotate(-90 60 60)">${arcs}</g></svg><div class="donut-mid"><span>${plural(rows.length, 'holding')}</span></div></div><ul class="legend">${legend}</ul>`;
}

/** Share of value by kind of asset. */
function mixBar(pf: PortfolioSummary): string {
  const by = new Map<string, number>();
  for (const r of pf.rows) if (r.weight > 0) by.set(KIND_LABEL[r.holding.ref.kind], (by.get(KIND_LABEL[r.holding.ref.kind]) ?? 0) + r.weight);
  const parts = [...by.entries()].sort((a, b) => b[1] - a[1]);
  if (parts.length < 2) return '';
  return `<div class="mix"><div class="mix-bar">${parts.map(([, w], i) => `<i style="width:${(w * 100).toFixed(1)}%;background:${PALETTE[i % PALETTE.length]}"></i>`).join('')}</div><ul class="legend legend-row">${parts.map(([k, w], i) => `<li><i style="background:${PALETTE[i % PALETTE.length]}"></i><span>${esc(k)}</span><b class="num">${(w * 100).toFixed(0)}%</b></li>`).join('')}</ul></div>`;
}

export const portfolioView: View = {
  mount(el) {
    const scope = new Scope();
    el.innerHTML = `<div class="page-head">
        <div><h1>Portfolio</h1><p>What you hold and what you watch, priced live. Nothing is bought or sold here.</p></div>
        <div class="page-tools">
          <button type="button" class="btn btn-primary" data-pf="add-holding">${icon.plus(15)} Add a holding</button>
          <button type="button" class="btn btn-outline" data-pf="add-watch">${icon.star(15)} Watch something</button>
        </div>
      </div>
      <div data-sync></div>
      <div class="pf-stats" data-stats></div>
      <div class="pf-grid">
        <div class="card" data-holdings></div>
        <div class="card pf-alloc" data-alloc></div>
      </div>
      <div class="card" data-watch></div>`;

    const refs = new Map<string, AssetRef>();

    const paint = frame(() => {
      const d = data.get();
      const pf = portfolioSummary();
      refs.clear();
      for (const h of d.holdings) refs.set(h.ref.key, h.ref);
      for (const w of d.watchlist) refs.set(w.key, w);

      const u = user.get();
      const sync = syncState.get();
      render(
        el.querySelector('[data-sync]'),
        u
          ? `<p class="sync-note">${sync === 'saving' ? `${icon.refresh(13)} Saving to your account…` : sync === 'error' ? `${icon.info(13)} Could not save to your account just now. Your changes are kept in this browser and will be retried.` : `${icon.check(13)} Saved with your account (${esc(u.email)}), so it follows you to any device.`}</p>`
          : d.holdings.length || d.watchlist.length
            ? `<div class="notice"><span>${icon.info(15)} Your lists are saved in this browser only. Sign in to keep them on every device.</span><button type="button" class="btn btn-outline btn-sm" data-pf="signin">Sign in</button></div>`
            : '',
      );

      const loading = crypto.get().status === 'loading' && equities.get().status === 'loading';
      const stat = (label: string, main: string, sub = '', tone = '') =>
        `<div class="card stat-card"><span class="stat-label">${label}</span><strong class="num ${tone}">${main}</strong><span class="stat-sub num ${tone}">${sub}</span></div>`;
      if (d.holdings.length) {
        const best = pf.rows.filter((r) => r.priced.change != null).sort((a, b) => (b.priced.change ?? 0) - (a.priced.change ?? 0));
        render(
          el.querySelector('[data-stats]'),
          stat('Total value', loading ? '<span class="sk">$00,000.00</span>' : money(pf.value), pf.unpriced ? `${plural(pf.unpriced, 'holding')} without a price` : plural(d.holdings.length, 'holding')) +
            stat('Today', signedMoney(pf.dayChange), pf.dayPct != null ? pct(pf.dayPct) : '', dir(pf.dayChange)) +
            (pf.withCost
              ? stat('Total gain', signedMoney(pf.gain), `${pf.gainPct != null ? pct(pf.gainPct) : ''}${pf.withCost < d.holdings.length ? ` · on ${pf.withCost} of ${d.holdings.length}` : ''}`, dir(pf.gain))
              : stat('Total gain', '—', 'Add the price you paid to see this')) +
            (best.length
              ? stat('Best and worst today', `${esc(best[0]!.holding.ref.sym)} ${pct(best[0]!.priced.change)}`, best.length > 1 ? `${esc(best[best.length - 1]!.holding.ref.sym)} ${pct(best[best.length - 1]!.priced.change)}` : '')
              : ''),
        );
      } else {
        render(el.querySelector('[data-stats]'), '');
      }

      render(
        el.querySelector('[data-holdings]'),
        d.holdings.length
          ? html`<div class="card-head"><h2 class="card-title">${raw(icon.wallet(16))} Holdings <span class="card-sub">${d.holdings.length} of ${MAX_HOLDINGS}</span></h2></div>
              <div class="table-wrap"><table class="table pf-table">
                <thead><tr><th>Asset</th><th class="r">Units</th><th class="r">Price</th><th class="r">Today</th><th class="r">Value</th><th class="r col-mid">Avg cost</th><th class="r">Gain</th><th class="r col-wide">Weight</th><th><span class="sr-only">Edit</span></th></tr></thead>
                <tbody>${raw(
                  pf.rows
                    .map((r) => {
                      const ref = r.holding.ref;
                      return `<tr ${rowAttrs(ref.key)}>
                        <td class="sticky-col">${assetCell(ref, r.priced.image)}</td>
                        <td class="r num">${quantity(r.holding.qty)}</td>
                        <td class="r num"><span data-flash="h${esc(ref.key)}" data-v="${r.priced.price ?? ''}">${priceText(ref, r.priced.price)}</span></td>
                        <td class="r num ${dir(r.priced.change)}"><div class="cell-stack"><span>${pct(r.priced.change)}</span><small>${r.dayChange != null ? signedMoney(r.dayChange) : ''}</small></div></td>
                        <td class="r num"><strong>${money(r.value)}</strong></td>
                        <td class="r num col-mid">${r.holding.cost != null ? priceText(ref, r.holding.cost) : '<span class="faint">—</span>'}</td>
                        <td class="r num ${dir(r.gain)}">${r.gain != null ? `<div class="cell-stack"><span>${signedMoney(r.gain)}</span><small>${pct(r.gainPct)}</small></div>` : '<span class="faint">—</span>'}</td>
                        <td class="r num col-wide">${r.weight ? `${(r.weight * 100).toFixed(1)}%` : '—'}</td>
                        <td class="r"><button type="button" class="icon-btn icon-btn-sm" data-edit-holding="${esc(ref.key)}" aria-label="Edit ${esc(ref.sym)} holding" title="Edit">${icon.edit(14)}</button></td>
                      </tr>`;
                    })
                    .join(''),
                )}</tbody>
              </table></div>`
          : html`<div class="empty">
              <div class="empty-art">${raw(icon.wallet(28))}</div>
              <h2>Track what you hold</h2>
              <p>Add a stock, fund or coin and how many you hold. You will see its live value, how it moved today and, if you add what you paid, your gain or loss.</p>
              <button type="button" class="btn btn-primary" data-pf="add-holding">${raw(icon.plus(15))} Add your first holding</button>
            </div>`,
      );

      render(
        el.querySelector('[data-alloc]'),
        d.holdings.length && pf.value > 0
          ? `<div class="card-head"><h2 class="card-title">${icon.target(16)} Allocation</h2></div><div class="card-body">${donut(pf)}${mixBar(pf)}</div>`
          : `<div class="card-head"><h2 class="card-title">${icon.target(16)} Allocation</h2></div><div class="card-body"><p class="muted">Once you add holdings, this shows how your money is spread across them.</p></div>`,
      );

      render(
        el.querySelector('[data-watch]'),
        d.watchlist.length
          ? html`<div class="card-head"><h2 class="card-title">${raw(icon.star(16))} Watchlist <span class="card-sub">${d.watchlist.length} of ${MAX_WATCH}</span></h2></div>
              <div class="table-wrap"><table class="table">
                <thead><tr><th>Asset</th><th class="col-mid">Type</th><th class="r">Price</th><th class="r">Today</th><th class="r col-mid">Week</th><th class="r col-wide">Market cap</th><th><span class="sr-only">Remove</span></th></tr></thead>
                <tbody>${raw(
                  d.watchlist
                    .map((ref) => {
                      const p = lookup(ref);
                      const week = p.coin ? p.coin.ch['7d'] : (p.equity?.ch['7d'] ?? (ref.yahoo ? (weekChanges.get(ref.yahoo) ?? null) : null));
                      return `<tr ${rowAttrs(ref.key)}>
                        <td class="sticky-col">${assetCell(ref, p.image)}</td>
                        <td class="col-mid"><span class="tag">${KIND_LABEL[ref.kind]}</span></td>
                        <td class="r num"><span data-flash="w${esc(ref.key)}" data-v="${p.price ?? ''}">${priceText(ref, p.price)}</span></td>
                        <td class="r num ${dir(p.change)}">${pct(p.change)}</td>
                        <td class="r num col-mid ${dir(week)}">${pct(week)}</td>
                        <td class="r num col-wide">${compact(p.marketCap)}</td>
                        <td class="r"><button type="button" class="icon-btn icon-btn-sm is-on" data-unwatch="${esc(ref.key)}" aria-label="Remove ${esc(ref.sym)} from watchlist" title="Remove from watchlist">${icon.starFill(14)}</button></td>
                      </tr>`;
                    })
                    .join(''),
                )}</tbody>
              </table></div>`
          : html`<div class="empty empty-small">
              <h2>Your watchlist is empty</h2>
              <p>Star anything from search or from the market tables to follow it here and on the overview.</p>
              <button type="button" class="btn btn-outline" data-pf="add-watch">${raw(icon.star(15))} Watch something</button>
            </div>`,
      );
      flash(el);
    });

    const want = () => {
      const d = data.get();
      const all = [...d.watchlist, ...d.holdings.map((h) => h.ref)];
      wantQuotes('portfolio', all.filter((r) => !r.cg && r.yahoo).map((r) => r.yahoo!));
      // Indexes, futures and other symbols outside the stock tables get their week change from the chart data.
      wantSparks(
        'portfolio',
        d.watchlist.filter((r) => !r.cg && r.yahoo && !lookup(r).equity).map((r) => r.yahoo!),
      );
    };

    scope.add(
      data.subscribe(() => {
        want();
        paint();
      }),
      crypto.subscribe(paint),
      equities.subscribe(paint),
      quotes.subscribe(paint),
      sparks.subscribe(paint),
      user.subscribe(paint),
      syncState.subscribe(paint),
      () => wantQuotes('portfolio', []),
      () => wantSparks('portfolio', []),
      on(el, 'click', '[data-pf]', (_e, t) => {
        const act = t.dataset.pf;
        if (act === 'signin') openAuth();
        else if (act === 'add-holding') openSearch({ title: 'Add a holding: choose what you hold', pick: (ref) => openHoldingForm(ref) });
        else if (act === 'add-watch') {
          openSearch({
            title: 'Add to your watchlist',
            pick: (ref) => {
              if (isWatched(ref.key)) {
                toast(`${ref.sym} is already on your watchlist.`);
                return;
              }
              const res = toggleWatch(ref);
              toast(res === 'full' ? 'Your watchlist is full.' : `${ref.sym} added to your watchlist.`, res === 'full' ? 'bad' : 'good');
            },
          });
        }
      }),
      on(el, 'click', '[data-edit-holding]', (ev, t) => {
        ev.stopPropagation();
        const ref = refs.get(t.dataset.editHolding!);
        if (ref) openHoldingForm(ref);
      }),
      on(el, 'click', '[data-unwatch]', (ev, t) => {
        ev.stopPropagation();
        const ref = refs.get(t.dataset.unwatch!);
        if (ref) {
          toggleWatch(ref);
          toast(`${ref.sym} removed from your watchlist.`);
        }
      }),
      on(el, 'click', '[data-asset]', (ev, row) => {
        if ((ev.target as Element).closest('button')) return;
        const ref = refs.get(row.dataset.asset!);
        if (ref) openAsset(ref);
      }),
      on(el, 'keydown', '[data-asset]', (ev, row) => {
        if ((ev.target as Element).closest('button') || (ev.key !== 'Enter' && ev.key !== ' ')) return;
        ev.preventDefault();
        const ref = refs.get(row.dataset.asset!);
        if (ref) openAsset(ref);
      }),
    );
    scope.interval(paint, 30_000);
    want();
    paint();
    return () => scope.dispose();
  },
};
