/** Full-size picture of a market: a bubble map of the biggest moves, or a heat map of everything by value. */
import { LAYER1 } from '../data/layer1';
import { crypto, equities, eth, loadEth } from '../data/market';
import {
  MOVER_CATS,
  biggestMoves,
  effectiveTf,
  loadSolana,
  moverPool,
  moverTip,
  noHistoryText,
  solana,
  tfLabel,
  tfOptions,
  type Mover,
  type MoverCat,
} from '../data/movers';
import { pref, setPref } from '../data/user';
import { frame, html, on, render } from '../lib/dom';
import { icon } from '../lib/icons';
import { Scope } from '../lib/store';
import type { View } from '../router';
import { createBubbleMap, type BubbleMap } from '../ui/bubbles';
import { openAsset } from '../ui/drawer';
import { createHeatMap, type HeatItem, type HeatMap } from '../ui/treemap';
import { bubbleCount, toBubbles, type SizeBy } from './parts/movers';
import { statusNote } from './parts/tables';

type Mode = 'bubbles' | 'tiles';

/** The change that earns the strongest colour, by timeframe. */
function fullScale(cat: MoverCat, tf: string): number {
  const eff = effectiveTf(cat, tf);
  const crypto = cat === 'cryptos' || cat === 'solana' || cat === 'ethereum';
  switch (eff) {
    case '1h':
      return crypto ? 2 : 1;
    case '4h':
      return 4;
    case '8h':
      return 5;
    case '6h':
      return 6;
    case '24h':
      return crypto ? 8 : 3;
    case '7d':
      return crypto ? 18 : 6;
    case '30d':
      return crypto ? 35 : 12;
    default:
      return crypto ? 80 : 30;
  }
}

export const heatmapView: View = {
  mount(el) {
    const scope = new Scope();
    const url = new URL(location.href);
    let cat = (url.searchParams.get('market') ?? pref('hm.cat', 'cryptos')) as MoverCat;
    if (!MOVER_CATS.some((c) => c.id === cat)) cat = 'cryptos';
    let mode = pref('hm.mode', 'bubbles') as Mode;
    let tf = pref('hm.tf', '24h');
    let sizeBy = pref('hm.size', 'move') as SizeBy;

    el.innerHTML = `<div class="page-head">
        <div><h1>Heat map</h1><p data-sub></p></div>
        <div class="page-tools" data-tools></div>
      </div>
      <div class="card hm-card"><div class="hm-host" data-host></div></div>
      <div class="hm-legend" data-legend></div>
      <p class="faint hm-note" data-note></p>`;
    const host = el.querySelector<HTMLElement>('[data-host]')!;
    let current = new Map<string, Mover>();
    let bubbles: BubbleMap | null = null;
    let tiles: HeatMap | null = null;
    let lastKey = '';

    const tooltip = (key: string) => {
      const m = current.get(key);
      return m ? moverTip(m, `Change, ${tfLabel(cat, tf)}`) : '';
    };
    const onPick = (key: string) => {
      const m = current.get(key);
      if (!m) return;
      if (m.ref) openAsset(m.ref);
      else if (m.href) window.open(m.href, '_blank', 'noopener');
    };

    const ensure = (want: Mode) => {
      if (want === 'bubbles' && !bubbles) {
        tiles?.destroy();
        tiles = null;
        bubbles = createBubbleMap(host, { tooltip, onPick });
        lastKey = '';
      } else if (want === 'tiles' && !tiles) {
        bubbles?.destroy();
        bubbles = null;
        tiles = createHeatMap(host, { tooltip, onPick });
        lastKey = '';
      }
    };
    scope.add(() => {
      bubbles?.destroy();
      tiles?.destroy();
    });

    const seg = (attr: string, options: [string, string][], value: string, label: string) =>
      `<div class="seg seg-scroll" role="group" aria-label="${label}">${options.map(([id, text]) => `<button type="button" class="seg-btn${id === value ? ' is-on' : ''}" data-${attr}="${id}" aria-pressed="${id === value ? 'true' : 'false'}">${text}</button>`).join('')}</div>`;

    const paint = frame(() => {
      // Solana tokens have no shared market-cap list to tile, so they are bubbles only.
      const effMode: Mode = cat === 'solana' ? 'bubbles' : mode;
      const options = tfOptions(cat);
      if (!options.some((o) => o.id === tf)) tf = options.some((o) => o.id === '24h') ? '24h' : options[0]!.id;
      render(
        el.querySelector('[data-tools]'),
        seg('hm-cat', MOVER_CATS.map((c) => [c.id, c.label]), cat, 'Market') +
          (cat === 'solana' ? '' : seg('hm-mode', [['bubbles', 'Bubbles'], ['tiles', 'Heat map']], effMode, 'View')) +
          seg('hm-tf', options.map((o) => [o.id, o.label]), tf, 'Timeframe') +
          seg('hm-size', effMode === 'bubbles' ? [['move', 'Size: move'], ['cap', 'Size: value']] : [['cap', 'Size: value'], ['move', 'Size: balanced']], sizeBy, 'Size'),
      );
      if (cat === 'solana') void loadSolana(tf);
      if (cat === 'ethereum') void loadEth();
      ensure(effMode);

      const label = tfLabel(cat, tf);
      let status: string;
      let at: number;
      let count: number;
      if (effMode === 'bubbles') {
        const res = biggestMoves(cat, tf, bubbleCount(host, 90));
        current = new Map(res.items.map((m) => [m.key, m]));
        const key = `b|${cat}|${tf}|${sizeBy}|${res.items.map((m) => `${m.key}:${(m.change ?? 0).toFixed(1)}`).join(',')}`;
        if (key !== lastKey) {
          lastKey = key;
          bubbles!.set(toBubbles(res.items, sizeBy), {
            exponent: sizeBy === 'cap' ? 0.3 : 0.5,
            emptyText: res.status === 'loading' ? 'Loading…' : res.status === 'error' ? 'This data is not available right now.' : res.noHistory ? noHistoryText(label) : 'Nothing moved enough to show here.',
          });
        }
        status = res.status;
        at = res.at;
        count = res.items.length;
      } else {
        const pool = moverPool(cat, tf);
        // Everything with a value, largest first; crypto is capped so the smallest tiles stay readable.
        const ranked = pool.items.filter((m) => (m.marketCap ?? 0) > 0).sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
        const list = cat === 'cryptos' || cat === 'ethereum' ? ranked.slice(0, 120) : ranked;
        current = new Map(list.map((m) => [m.key, m]));
        const key = `t|${cat}|${tf}|${sizeBy}|${list.map((m) => `${m.key}:${(m.change ?? 0).toFixed(2)}`).join(',')}`;
        if (key !== lastKey) {
          lastKey = key;
          const es = equities.get().bySymbol;
          const items: HeatItem[] = list.map((m) => ({
            key: m.key,
            label: m.sym,
            change: m.change,
            // "Balanced" flattens the scale so a few giants do not crowd out everything else.
            weight: sizeBy === 'move' ? Math.pow(m.marketCap ?? 0, 0.45) : (m.marketCap ?? 0),
            group: cat === 'ethereum' ? (m.key === 'c:ethereum' ? 'Ether' : 'Ethereum tokens') : cat === 'cryptos' ? (m.key === 'c:bitcoin' ? 'Bitcoin' : m.key === 'c:ethereum' ? 'Ethereum' : LAYER1.has(m.key.slice(2)) ? 'Other layer 1s' : 'Tokens and apps') : (es.get(m.sym)?.group ?? 'Other'),
          }));
          tiles!.set(items, {
            full: fullScale(cat, tf),
            emptyText: pool.status === 'loading' ? 'Loading…' : pool.noHistory ? noHistoryText(label) : 'This data is not available right now.',
          });
        }
        status = pool.status;
        at = pool.at;
        count = list.length;
      }

      const what = cat === 'cryptos' ? 'coins' : cat === 'solana' ? 'Solana tokens' : cat === 'ethereum' ? 'Ethereum tokens' : cat === 'stocks' ? 'stocks' : 'ETFs';
      render(
        el.querySelector('[data-sub]'),
        html`${effMode === 'bubbles' ? `The ${count} biggest moves among ${cat === 'cryptos' ? 'liquid top-250 coins' : cat === 'ethereum' ? 'liquid Ethereum tokens' : what} over ${label}.` : `${count} ${what} sized by ${sizeBy === 'move' ? 'value (balanced)' : cat === 'etfs' ? 'assets' : 'market cap'}, coloured by change over ${label}.`} Select one for details.`,
      );
      const full = fullScale(cat, tf);
      render(
        el.querySelector('[data-legend]'),
        effMode === 'tiles'
          ? `<span class="num">−${full}%</span>${[1, 0.6, 0.2].map((s) => `<i class="heat-tile down" style="--s:${s}"></i>`).join('')}<i class="heat-tile flat" style="--s:0"></i>${[0.2, 0.6, 1].map((s) => `<i class="heat-tile up" style="--s:${s}"></i>`).join('')}<span class="num">+${full}%</span>`
          : `<span>${icon.bubbles(14)} Bigger bubble: ${sizeBy === 'cap' ? 'larger market value' : 'bigger move'}. Brighter colour: bigger move.</span>`,
      );
      const source = cat === 'cryptos' || cat === 'ethereum' ? 'CoinGecko' : cat === 'solana' ? 'Jupiter' : 'Yahoo Finance';
      render(el.querySelector('[data-note]'), html`${statusNote(status, at, source)}. Third-party data, may be delayed.`);
    });

    scope.add(
      crypto.subscribe(paint),
      equities.subscribe(paint),
      solana.subscribe(paint),
      eth.subscribe(paint),
      on(el, 'click', '[data-hm-cat]', (_e, t) => {
        setPref('hm.cat', (cat = t.dataset.hmCat as MoverCat));
        paint();
      }),
      on(el, 'click', '[data-hm-mode]', (_e, t) => {
        setPref('hm.mode', (mode = t.dataset.hmMode as Mode));
        paint();
      }),
      on(el, 'click', '[data-hm-tf]', (_e, t) => {
        setPref('hm.tf', (tf = t.dataset.hmTf!));
        paint();
      }),
      on(el, 'click', '[data-hm-size]', (_e, t) => {
        setPref('hm.size', (sizeBy = t.dataset.hmSize as SizeBy));
        paint();
      }),
    );
    scope.interval(() => {
      if (cat === 'solana') void loadSolana(tf);
      if (cat === 'ethereum') void loadEth();
      paint();
    }, 60_000);
    paint();
    return () => scope.dispose();
  },
};
