/** Key-market tiles and the indexes row: price, day change and a one-year sparkline. */
import { heroFromRef, lookup, priceText, refFromHero, unitSuffix, avatar, type AssetRef } from '../../data/assets';
import { crypto, equities, quotes, sparks, wantQuotes, wantSparks } from '../../data/market';
import { heroDefs, indexDefs, saveHero, saveIndexes, user, type HeroAssetDef } from '../../data/user';
import { frame, html, on, raw, render } from '../../lib/dom';
import { dir, pct, until } from '../../lib/format';
import { icon } from '../../lib/icons';
import { sparkline } from '../../lib/spark';
import type { Scope } from '../../lib/store';
import { openAuth } from '../../ui/auth';
import { openAsset } from '../../ui/drawer';
import { flash } from '../../ui/flash';
import { openSearch } from '../../ui/search';
import { toast } from '../../ui/toast';

/**
 * Estimated date of the next Bitcoin halving (block 1,050,000). Blocks arrive
 * about every ten minutes, so this is an estimate that drifts by days.
 */
const NEXT_HALVING = Date.UTC(2028, 3, 17);

function halvingBadge(): string {
  const ms = NEXT_HALVING - Date.now();
  if (ms <= 0) return '';
  return `<span class="tile-badge" title="Estimated time to the next Bitcoin halving (around April 2028)">${icon.clock(11)}<span><span class="tile-badge-word">Halving </span>~${until(ms).replace(/ \d+h$/, '')}</span></span>`;
}

/** The Yahoo symbol whose one-year series draws a tile's sparkline. */
function sparkSymbol(ref: AssetRef, def: HeroAssetDef): string {
  return ref.cg ? def.yahoo : (ref.yahoo ?? def.yahoo);
}

function tileHtml(def: HeroAssetDef, slot: number, section: 'hero' | 'indexes', canEdit: boolean): string {
  const ref = refFromHero(def);
  const p = lookup(ref);
  const d = dir(p.change);
  const series = sparks.get().get(sparkSymbol(ref, def)) ?? p.equity?.spark ?? null;
  // Tie the right-hand end of the line to the live price.
  const line = series && series.length > 1 && p.price != null ? [...series.slice(0, -1), p.price] : series;
  const yearChange = line && line.length > 1 && series === sparks.get().get(sparkSymbol(ref, def)) ? (line[line.length - 1]! / line[0]! - 1) * 100 : null;
  const isBtc = ref.sym.toUpperCase() === 'BTC';
  const loading = p.price == null && (crypto.get().status === 'loading' || equities.get().status === 'loading' || !quotes.get().size);
  return html`<article class="card tile${p.price == null ? ' is-empty' : ''}" data-tile="${section}:${slot}">
    <button type="button" class="tile-open" data-open-tile="${section}:${slot}" aria-label="${ref.name}: details"></button>
    <div class="tile-head">${raw(avatar(ref, p.image, 20))}<span title="${ref.name}">${ref.sym}</span>${raw(isBtc ? halvingBadge() : '')}</div>
    <div class="tile-price num" data-flash="${section}${slot}" data-v="${p.price ?? ''}">${raw(loading ? '<span class="sk">00,000.00</span>' : html`${priceText(ref, p.price)}<small>${unitSuffix(ref)}</small>`)}</div>
    <div class="tile-row">
      ${raw(loading ? '<span class="sk">+0.00%</span>' : `<span class="pill ${d} num">${pct(p.change)}</span><span class="muted">${p.coin ? '24h' : 'today'}</span>${p.stale ? '<span class="tag tag-warn">Delayed</span>' : ''}`)}
    </div>
    <div class="tile-spark">
      ${raw(yearChange != null ? `<span class="tile-spark-label num">1Y ${pct(yearChange, 0)}</span>` : '')}
      ${raw(sparkline(line, { w: 200, h: 40 }))}
    </div>
    ${raw(canEdit ? `<button type="button" class="icon-btn icon-btn-sm tile-edit" data-edit-tile="${section}:${slot}" aria-label="Change this tile" title="Change this tile">${icon.edit(14)}</button>` : '')}
  </article>`;
}

export function mountTiles(heroEl: HTMLElement, indexEl: HTMLElement, scope: Scope): void {
  const paint = frame(() => {
    const canEdit = !!user.get();
    render(heroEl, heroDefs.get().map((d, i) => tileHtml(d, i, 'hero', canEdit)).join(''));
    render(indexEl, indexDefs.get().map((d, i) => tileHtml(d, i, 'indexes', canEdit)).join(''));
    flash(heroEl);
    flash(indexEl);
  });

  const want = () => {
    const defs = [...heroDefs.get(), ...indexDefs.get()];
    const refs = defs.map(refFromHero);
    wantQuotes('tiles', refs.filter((r) => !r.cg && r.yahoo).map((r) => r.yahoo!));
    wantSparks('tiles', defs.map((d, i) => sparkSymbol(refs[i]!, d)));
  };

  scope.add(
    heroDefs.subscribe(() => {
      want();
      paint();
    }),
    indexDefs.subscribe(() => {
      want();
      paint();
    }),
    crypto.subscribe(paint),
    equities.subscribe(paint),
    quotes.subscribe(paint),
    sparks.subscribe(paint),
    user.subscribe(paint),
    () => {
      wantQuotes('tiles', []);
      wantSparks('tiles', []);
    },
  );
  scope.interval(paint, 60_000);
  want();
  paint();

  const defAt = (id: string): { section: 'hero' | 'indexes'; slot: number; def: HeroAssetDef | undefined } => {
    const [section, slot] = id.split(':') as ['hero' | 'indexes', string];
    const list = section === 'hero' ? heroDefs.get() : indexDefs.get();
    return { section, slot: Number(slot), def: list[Number(slot)] };
  };

  const root = heroEl.parentElement?.parentElement ?? document.body;
  scope.add(
    on(root, 'click', '[data-open-tile]', (_ev, el) => {
      const { def } = defAt(el.dataset.openTile!);
      if (def) openAsset(refFromHero(def));
    }),
    on(root, 'click', '[data-edit-tile]', (ev, el) => {
      ev.stopPropagation();
      if (!user.get()) {
        openAuth();
        return;
      }
      const { section, slot } = defAt(el.dataset.editTile!);
      openSearch({
        title: section === 'hero' ? `Choose what tile ${slot + 1} shows` : `Choose what index tile ${slot + 1} shows`,
        pick: async (ref) => {
          const list = (section === 'hero' ? heroDefs.get() : indexDefs.get()).map((d) => ({ ...d }));
          const next = heroFromRef(ref);
          if (list.some((d, i) => i !== slot && d.yahoo.toUpperCase() === next.yahoo.toUpperCase())) {
            toast(`${ref.sym} is already on another tile.`, 'bad');
            return;
          }
          list[slot] = next;
          const ok = await (section === 'hero' ? saveHero(list) : saveIndexes(list));
          toast(ok ? `Tile changed to ${ref.sym}.` : 'That could not be saved. Try again.', ok ? 'good' : 'bad');
        },
      });
    }),
  );
}
