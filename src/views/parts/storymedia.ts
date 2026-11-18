/**
 * The picture of a news story, at any size, with artwork underneath.
 *
 * The artwork is always drawn: it is what shows while the picture loads, when
 * a story has none, and when the publisher's server refuses it (the picture
 * removes itself on error). It uses the topic's colours and emblem, or the
 * logo of the company or coin the headline is about.
 */
import type { TopicId } from '../../../functions/_shared/newsTopics';
import { stockLogo } from '../../data/assets';
import { crypto } from '../../data/market';
import { brandOf, type Brand } from '../../lib/brands';
import { html, raw } from '../../lib/dom';

export type MediaSize = 's' | 'm' | 'l';

/** 24-unit line drawings, one per topic. */
const EMBLEM: Record<TopicId, string> = {
  markets: '<path d="M3 20h18"/><path d="m4 16 5-5 4 3 7-8"/><path d="M15 6h5v5"/>',
  investing: '<path d="M11 3.5a8.5 8.5 0 1 0 9.5 9.5H11z"/><path d="M14 2.6a8.5 8.5 0 0 1 7.4 7.4H14z"/>',
  'personal-finance': '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3"/><rect x="4" y="8" width="16" height="11" rx="2.4"/><path d="M16 13.5h.1"/>',
  crypto: '<circle cx="12" cy="12" r="9"/><path d="M9.5 7.5h3.8a2.1 2.1 0 0 1 0 4.2H9.5zM9.5 11.7h4.4a2.15 2.15 0 0 1 0 4.3H9.5zM9.5 7.5V16M11 5.8v1.7M13 5.8v1.7M11 16v1.8M13 16v1.8"/>',
  'real-estate': '<path d="m3 11 9-7 9 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
  technology: '<rect x="7" y="7" width="10" height="10" rx="1.6"/><path d="M10 10h4v4h-4zM9.5 3v4M14.5 3v4M9.5 17v4M14.5 17v4M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/>',
  policy: '<path d="m3 9 9-5 9 5z"/><path d="M5 20h14M4 17h16M6.5 10v7M10.2 10v7M13.8 10v7M17.5 10v7"/>',
  business: '<rect x="3" y="7" width="18" height="13" rx="2.2"/><path d="M8.5 7V5.2A1.2 1.2 0 0 1 9.7 4h4.6a1.2 1.2 0 0 1 1.2 1.2V7M3 12.5h18M11 12.5v1.6h2v-1.6"/>',
  commodities: '<path d="M12 3s6 6.4 6 10.9A6 6 0 0 1 6 13.9C6 9.4 12 3 12 3z"/><path d="M9.2 14.6a2.9 2.9 0 0 0 2.6 2.7"/>',
  healthcare: '<path d="M12 20s-7.2-4.3-8.9-9A4.6 4.6 0 0 1 12 8.2 4.6 4.6 0 0 1 20.9 11c-1.7 4.7-8.9 9-8.9 9z"/><path d="M6.5 12.5h3l1.4-2.4 2.3 4.6 1.4-2.2h3"/>',
};

/** Coin logos when the price feed has not arrived yet. */
const COIN_LOGO: Record<string, string> = {
  bitcoin: 'https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png',
  ethereum: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png',
  solana: 'https://coin-images.coingecko.com/coins/images/4128/large/solana.png',
  ripple: 'https://coin-images.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png',
  dogecoin: 'https://coin-images.coingecko.com/coins/images/5/large/dogecoin.png',
  cardano: 'https://coin-images.coingecko.com/coins/images/975/large/cardano.png',
  binancecoin: 'https://coin-images.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
  tether: 'https://coin-images.coingecko.com/coins/images/325/large/Tether.png',
};

function logoOf(b: Brand): string | null {
  if (b.stock) return stockLogo(b.stock);
  if (b.coin) return crypto.get().byId.get(b.coin)?.image ?? COIN_LOGO[b.coin] ?? null;
  return null;
}

/** Outlet name without its desk: "CNBC Markets" -> "CNBC". Two-word outlets keep both words. */
function outletLabel(source: string): string {
  const fam = /^(NYT|BBC|CNBC|WSJ|Guardian|MarketWatch|CoinDesk|Cointelegraph|TechCrunch|Reuters|Bloomberg)\b/.exec(source)?.[1];
  return fam ?? source;
}

export type MediaOpts = {
  /** Picture address (already checked to be http(s) or a site path). */
  image: string | null;
  title: string;
  topic: TopicId;
  source?: string;
  size: MediaSize;
  /** Makes the whole picture a link to the story (kept out of the tab order: the headline is the link). */
  link?: string;
  /** Story id, so a click on the picture counts as read. */
  id?: string;
  className?: string;
  /** The first picture on screen loads straight away. */
  eager?: boolean;
};

/** The artwork alone: topic colours and emblem, or a company or coin logo. */
export function artHtml(o: { title: string; topic: TopicId; source?: string; size: MediaSize; brand?: boolean }): string {
  const brand = o.brand === false ? null : brandOf(o.title);
  const logo = brand ? logoOf(brand) : null;
  return html`<span class="nb-art" aria-hidden="true">
    <svg class="nb-em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${raw(EMBLEM[o.topic])}</svg>
    ${raw(
      logo && brand
        ? html`<span class="nb-logo"><img src="${logo}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.remove()" /><b>${brand.name}</b></span>`
        : '',
    )}
    ${raw(o.source && o.size !== 's' ? html`<span class="nb-art-src">${outletLabel(o.source)}</span>` : '')}
  </span>`;
}

/** A story's picture with its artwork underneath, as a link when `link` is given. */
export function mediaHtml(o: MediaOpts): string {
  const cls = `nb-media sz-${o.size} t-${o.topic}${o.className ? ` ${o.className}` : ''}`;
  // Only stories without a picture look for a logo, so a covered logo is never downloaded.
  const art = artHtml({ title: o.title, topic: o.topic, source: o.source, size: o.size, brand: !o.image });
  const img = o.image
    ? html`<img src="${o.image}" alt="" loading="${o.eager ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()" />`
    : '';
  if (o.link) {
    return html`<a class="${cls}" href="${o.link}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true"${raw(o.id ? html` data-open="${o.id}"` : '')}>${raw(art)}${raw(img)}</a>`;
  }
  return html`<span class="${cls}" aria-hidden="true">${raw(art)}${raw(img)}</span>`;
}
