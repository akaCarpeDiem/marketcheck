/**
 * The page frame (top bar, footer, phone tab bar) as HTML strings.
 * Used twice: by scripts/build.mjs to write it into every HTML document, and
 * by the app in the browser. Keep it free of DOM and browser-only code.
 */
import { icon, logoMark } from '../lib/icons';

export type NavId = 'overview' | 'markets' | 'heatmap' | 'portfolio' | 'news' | 'podcasts';

/** `tab: false` keeps an entry out of the phone tab bar, which has room for five. */
export const NAV: { id: NavId; href: string; label: string; short: string; icon: (s?: number) => string; tab?: boolean }[] = [
  { id: 'overview', href: '/', label: 'Overview', short: 'Overview', icon: icon.home },
  { id: 'markets', href: '/markets/', label: 'Markets', short: 'Markets', icon: icon.chart },
  { id: 'heatmap', href: '/heatmap/', label: 'Heat map', short: 'Heat map', icon: icon.bubbles },
  { id: 'portfolio', href: '/portfolio/', label: 'Portfolio', short: 'Portfolio', icon: icon.wallet },
  { id: 'news', href: '/news/', label: 'News', short: 'News', icon: icon.news },
  { id: 'podcasts', href: '/podcasts/', label: 'Podcasts', short: 'Podcasts', icon: icon.mic, tab: false },
];

export const FOOT_LINKS: { href: string; label: string }[] = [
  { href: '/podcasts/', label: 'Podcasts' },
  { href: '/about/', label: 'About' },
  { href: '/sources/', label: 'Sources & methods' },
  { href: '/privacy/', label: 'Privacy' },
  { href: '/terms/', label: 'Terms' },
  { href: '/contact/', label: 'Contact' },
];

export function logoHtml(): string {
  return `<a class="logo" href="/" aria-label="Market Check home">${logoMark(40)}<span class="logo-word"><span class="logo-a">Market</span><span class="logo-b">Check</span></span></a>`;
}

/**
 * Top bar. The right-hand side (market status, account) is filled in by the
 * app once it knows the state; the static version shows neutral placeholders
 * of the same size so nothing jumps.
 */
export function topbarHtml(active: NavId | null): string {
  const links = NAV.map(
    (n) =>
      `<a class="nav-link${n.id === active ? ' is-active' : ''}" href="${n.href}" data-nav="${n.id}"${n.id === active ? ' aria-current="page"' : ''}>${n.label}</a>`,
  ).join('');
  return `<div class="topbar-in">
    ${logoHtml()}
    <nav class="nav" aria-label="Sections">${links}</nav>
    <button type="button" class="search-open" data-action="search" aria-label="Search stocks, ETFs and crypto">
      ${icon.search(15)}<span class="search-open-text">Search stocks, ETFs, crypto</span><kbd>/</kbd>
    </button>
    <div class="topbar-right">
      <div class="mkt-chip" id="mkt-chip" role="status" aria-live="polite"></div>
      <button type="button" class="icon-btn" data-action="theme" aria-label="Switch between dark and light">${icon.sun(16)}</button>
      <div class="account" id="account"><button type="button" class="btn btn-primary btn-sm signin-btn" data-action="signin">${icon.user(15)}<span>Sign in</span></button></div>
    </div>
  </div>`;
}

export function tabbarHtml(active: NavId | null): string {
  // On a phone, Podcasts is reached from News; while there, the News tab stays lit.
  const lit = active === 'podcasts' ? 'news' : active;
  return NAV.filter((n) => n.tab !== false).map(
    (n) =>
      `<a class="tab${n.id === lit ? ' is-active' : ''}" href="${n.href}" data-nav="${n.id}"${n.id === lit ? ' aria-current="page"' : ''}>${n.icon(20)}<span>${n.short}</span></a>`,
  ).join('');
}

export function footerHtml(): string {
  const links = FOOT_LINKS.map((l) => `<a href="${l.href}">${l.label}</a>`).join('');
  return `<div class="foot-in">
    <div class="foot-brand">
      ${logoHtml()}
      <p>A free dashboard of live market prices and the headlines that move them: crypto, US stocks and ETFs, indexes, commodities and news.</p>
    </div>
    <nav class="foot-links" aria-label="About this site">${links}</nav>
    <div class="foot-note">
      <p><strong>Not financial advice.</strong> Market Check on marketcheck.money is not a brokerage, exchange, adviser or bank, and nothing here is a recommendation to buy, sell or hold anything. Prices come from public third-party sources (CoinGecko, Yahoo Finance, Jupiter, public RSS feeds) and can be delayed or wrong.</p>
      <p class="foot-small">Market Check is not MarketCheck the car-listing company. <span id="foot-updated"></span></p>
    </div>
  </div>`;
}
