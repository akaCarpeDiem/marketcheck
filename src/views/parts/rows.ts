/** Shared table cells for asset lists. */
import { avatar, type AssetRef } from '../../data/assets';
import { esc } from '../../lib/dom';
import { dir, pct } from '../../lib/format';

/** Logo, ticker and name in one cell. */
export function assetCell(ref: AssetRef, image: string | null | undefined, size = 26): string {
  return `<div class="cell-asset">${avatar(ref, image, size)}<div class="cell-stack"><strong>${esc(ref.sym)}</strong><span class="cell-name">${esc(ref.name)}</span></div></div>`;
}

/** A coloured percent change, right-aligned. */
export function changeCell(value: number | null | undefined, cls = ''): string {
  return `<td class="r num ${dir(value)} ${cls}">${pct(value)}</td>`;
}

/** Attributes that make a table row open an asset on click or Enter. */
export function rowAttrs(key: string): string {
  return `data-asset="${esc(key)}" tabindex="0" role="button"`;
}
