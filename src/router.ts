/** Client-side navigation between the app's pages. Text pages are normal page loads. */
import { reducedMotion } from './lib/dom';
import { signal } from './lib/store';
import type { NavId } from './site/shell';

export type ViewId = NavId;

export type View = {
  /** Draw into `el`. Return a function that cleans up when the view goes away. */
  mount(el: HTMLElement): () => void;
};

const ROUTES: Record<string, ViewId> = {
  '/': 'overview',
  '/markets/': 'markets',
  '/heatmap/': 'heatmap',
  '/portfolio/': 'portfolio',
  '/news/': 'news',
};

const TITLES: Record<ViewId, string> = {
  overview: 'Market Check — Live crypto, stocks, commodities & headlines',
  markets: 'Markets: crypto, stocks and ETFs by market cap · Market Check',
  heatmap: 'Heat map and bubble map: what is moving · Market Check',
  portfolio: 'Portfolio and watchlist · Market Check',
  news: 'Market headlines: finance, crypto, technology and AI · Market Check',
};

export const currentView = signal<ViewId | null>(null);

let loaders: Record<ViewId, () => View>;
let host: HTMLElement;
let dispose: (() => void) | null = null;
const scrollByKey = new Map<string, number>();
let navKey = 0;

function normalize(pathname: string): string {
  let p = pathname;
  if (!p.endsWith('/')) p += '/';
  return p;
}

export function viewForPath(pathname: string): ViewId | null {
  return ROUTES[normalize(pathname)] ?? null;
}

export function pathForView(view: ViewId): string {
  return Object.entries(ROUTES).find(([, v]) => v === view)![0];
}

function show(view: ViewId, restoreScroll: number | null): void {
  const swap = () => {
    dispose?.();
    dispose = null;
    host.className = `view view-${view}`;
    host.innerHTML = '';
    document.getElementById('app')?.setAttribute('data-view', view);
    currentView.set(view);
    document.title = TITLES[view];
    document
      .querySelector('link[rel="canonical"]')
      ?.setAttribute('href', `https://marketcheck.money${pathForView(view)}`);
    dispose = loaders[view]().mount(host);
    window.scrollTo(0, restoreScroll ?? 0);
  };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (currentView.get() && doc.startViewTransition && !reducedMotion()) doc.startViewTransition(swap);
  else swap();
}

/** Go to an app page. `href` may include a query string. */
export function navigate(href: string, opts: { replace?: boolean } = {}): boolean {
  const url = new URL(href, location.href);
  const view = viewForPath(url.pathname);
  if (!view || url.origin !== location.origin) return false;
  const same = url.pathname === location.pathname;
  scrollByKey.set(String(history.state?.k ?? 0), window.scrollY);
  navKey += 1;
  const state = { k: navKey };
  if (opts.replace) history.replaceState(state, '', url.pathname + url.search);
  else history.pushState(state, '', url.pathname + url.search);
  if (!same || currentView.get() !== view) show(view, null);
  window.dispatchEvent(new Event('mc:location'));
  return true;
}

/** Change the query string without leaving the page (used for ?q= and view options). */
export function setQuery(params: Record<string, string | null>, opts: { replace?: boolean } = {}): void {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  const next = url.pathname + url.search;
  if (next === location.pathname + location.search) return;
  if (opts.replace) history.replaceState(history.state, '', next);
  else history.pushState({ k: (navKey += 1) }, '', next);
  window.dispatchEvent(new Event('mc:location'));
}

export function startRouter(el: HTMLElement, views: Record<ViewId, () => View>): void {
  host = el;
  loaders = views;
  history.scrollRestoration = 'manual';
  if (history.state?.k == null) history.replaceState({ k: 0 }, '', location.href);

  document.addEventListener('click', (ev) => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const a = (ev.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !viewForPath(url.pathname)) return;
    // Only take over when the app is running on this page.
    if (!currentView.get()) return;
    ev.preventDefault();
    navigate(url.pathname + url.search);
  });

  window.addEventListener('popstate', () => {
    const view = viewForPath(location.pathname);
    if (view && view !== currentView.get()) {
      show(view, scrollByKey.get(String(history.state?.k ?? 0)) ?? 0);
    }
    window.dispatchEvent(new Event('mc:location'));
  });

  const first = viewForPath(location.pathname);
  if (first) show(first, null);
}
