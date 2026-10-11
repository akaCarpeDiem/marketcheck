/** The heat map: a treemap of tiles sized by value and coloured by change. */
import { debounce, esc } from '../lib/dom';
import { groupedTreemap, type TreeGroup } from '../lib/treemap';

export type HeatItem = {
  key: string;
  label: string;
  change: number | null;
  weight: number;
  group: string;
};

export type HeatMap = {
  /** `full` is the change (percent) that gets the strongest colour. */
  set(items: HeatItem[], opts: { full: number; emptyText?: string }): void;
  destroy(): void;
};

/** Colour strength 0..1 for a change, in five steps so tiles read as clear bands. */
function strength(change: number | null, full: number): number {
  if (change == null) return 0;
  const t = Math.min(1, Math.abs(change) / full);
  return Math.ceil(t * 5) / 5;
}

export function createHeatMap(
  host: HTMLElement,
  opts: { tooltip: (key: string) => string; onPick: (key: string) => void },
): HeatMap {
  host.classList.add('heat');
  host.innerHTML = '<div class="heat-tiles"></div><div class="bubble-tip" hidden></div><div class="bubbles-empty" hidden></div>';
  const layer = host.querySelector<HTMLElement>('.heat-tiles')!;
  const tip = host.querySelector<HTMLElement>('.bubble-tip')!;
  const empty = host.querySelector<HTMLElement>('.bubbles-empty')!;
  let items: HeatItem[] = [];
  let full = 3;
  let destroyed = false;

  function draw(): void {
    const rect = host.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    if (w < 40 || h < 40 || !items.length) {
      layer.innerHTML = '';
      return;
    }
    const byGroup = new Map<string, TreeGroup<HeatItem>>();
    for (const it of items) {
      if (!(it.weight > 0)) continue;
      let g = byGroup.get(it.group);
      if (!g) byGroup.set(it.group, (g = { name: it.group, items: [] }));
      g.items.push({ item: it, weight: it.weight });
    }
    const { tiles, groups } = groupedTreemap([...byGroup.values()], { x: 0, y: 0, w, h }, { header: 20, gap: 2 });
    let markup = '';
    for (const g of groups) {
      if (!g.header) continue;
      markup += `<div class="heat-group" style="left:${g.rect.x.toFixed(1)}px;top:${g.rect.y.toFixed(1)}px;width:${g.rect.w.toFixed(1)}px;height:${g.header + 2}px">${esc(g.name)}</div>`;
    }
    for (const t of tiles) {
      const r = t.rect;
      if (r.w < 3 || r.h < 3) continue;
      const ch = t.item.change;
      const tone = ch == null || Math.abs(ch) < 0.005 ? 'flat' : ch > 0 ? 'up' : 'down';
      const s = strength(ch, full);
      // Text sized to the tile; small tiles show the ticker only, tiny ones nothing.
      const pctText = ch == null ? '' : `${ch > 0 ? '+' : ch < 0 ? '−' : ''}${Math.abs(ch).toFixed(Math.abs(ch) >= 100 ? 0 : 2)}%`;
      const room = r.w - 8;
      const labelEm = t.item.label.length * 0.7;
      const pctEm = pctText.length * 0.43;
      let size = Math.min(26, room / Math.max(labelEm, pctEm), (r.h - 4) / 2.5);
      let showPct = size >= 9 && pctText !== '';
      if (!showPct) size = Math.min(26, room / labelEm, (r.h - 4) / 1.3);
      // Prefer a readable ticker alone over a ticker and percent that are both too small.
      if (showPct && size < 10.5) {
        const alone = Math.min(26, room / labelEm, (r.h - 4) / 1.3);
        if (alone >= size * 1.25) {
          size = alone;
          showPct = false;
        }
      }
      const showText = size >= 8;
      size = Math.max(8, size);
      markup += `<button type="button" class="heat-tile ${tone}" data-key="${esc(t.item.key)}" style="left:${(r.x + 1).toFixed(1)}px;top:${(r.y + 1).toFixed(1)}px;width:${Math.max(0, r.w - 2).toFixed(1)}px;height:${Math.max(0, r.h - 2).toFixed(1)}px;--s:${s};font-size:${size.toFixed(1)}px" aria-label="${esc(t.item.label)} ${esc(pctText)}">${showText ? `<b>${esc(t.item.label)}</b>${showPct ? `<span>${pctText}</span>` : ''}` : ''}</button>`;
    }
    layer.innerHTML = markup;
  }

  const showTip = (el: HTMLElement | null) => {
    if (!el) {
      tip.hidden = true;
      return;
    }
    tip.innerHTML = opts.tooltip(el.dataset.key!);
    tip.hidden = false;
    const hostRect = host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = r.left - hostRect.left + r.width / 2 - tw / 2;
    left = Math.max(6, Math.min(hostRect.width - tw - 6, left));
    let top = r.top - hostRect.top - th - 6;
    if (top < 4) top = Math.min(hostRect.height - th - 4, r.bottom - hostRect.top + 6);
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };

  layer.addEventListener('pointerover', (ev) => {
    if (ev.pointerType === 'touch') return;
    showTip((ev.target as Element).closest<HTMLElement>('.heat-tile'));
  });
  layer.addEventListener('pointerleave', () => showTip(null));
  layer.addEventListener('focusin', (ev) => showTip((ev.target as Element).closest<HTMLElement>('.heat-tile')));
  layer.addEventListener('focusout', () => showTip(null));
  layer.addEventListener('click', (ev) => {
    const el = (ev.target as Element).closest<HTMLElement>('.heat-tile');
    if (el) opts.onPick(el.dataset.key!);
  });

  const ro = new ResizeObserver(
    debounce(() => {
      if (!destroyed) draw();
    }, 80),
  );
  ro.observe(host);

  return {
    set(next, o) {
      items = next;
      full = o.full;
      const has = next.some((it) => it.weight > 0);
      empty.hidden = has;
      empty.textContent = has ? '' : (o.emptyText ?? 'Nothing to show right now.');
      tip.hidden = true;
      draw();
    },
    destroy() {
      destroyed = true;
      ro.disconnect();
      host.textContent = '';
      host.classList.remove('heat');
    },
  };
}
