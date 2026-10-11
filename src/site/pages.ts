/**
 * The list of pages and the HTML document around each one. Bundled and run by
 * scripts/build.mjs at build time; nothing here runs in the browser.
 */
import { footerHtml, tabbarHtml, topbarHtml, type NavId } from './shell';

const SITE = 'https://marketcheck.money';
const GA_ID = 'G-EN7YS4P0XE';

export type Page = {
  /** URL path, with trailing slash. */
  path: string;
  /** File written under dist/. */
  file: string;
  /** App view that takes over <main>, or "static" for text pages. */
  view: NavId | 'static' | 'notfound';
  title: string;
  description: string;
  /** Text shown inside <main> before the app starts (and to crawlers). */
  body: string;
  /** false keeps the page out of the sitemap and tells robots not to index it. */
  index?: boolean;
};

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Intro block for an app page: real text for crawlers and for the moment before the app paints. */
function intro(h1: string, paragraphs: string[]): string {
  return `<section class="page-intro"><h1>${h1}</h1>${paragraphs.map((p) => `<p>${p}</p>`).join('')}</section>
<noscript><p class="page-intro">This page needs JavaScript to load live prices.</p></noscript>`;
}

const APP_PAGES: Page[] = [
  {
    path: '/',
    file: 'index.html',
    view: 'overview',
    title: 'Market Check — Live crypto, stocks, commodities & headlines',
    description:
      'Market Check is a free dashboard of live crypto, stock, ETF, index and commodity prices with the headlines that move them. Track a watchlist and portfolio. Not financial advice.',
    body: intro('Market Check', [
      'A free dashboard of live market prices and the headlines that move them: crypto, US stocks and ETFs, indexes, gold, silver and oil, on one page.',
      'See what is moving right now, follow your own watchlist and portfolio, and pick the tiles you care about. Data comes from public third-party sources and may be delayed. Not financial advice.',
    ]),
  },
  {
    path: '/markets/',
    file: 'markets/index.html',
    view: 'markets',
    title: 'Markets: crypto, stocks and ETFs by market cap · Market Check',
    description:
      'Sortable tables of the 250 largest cryptocurrencies, 100+ large US stocks and 50 major ETFs with price, day, week, month and year changes and market cap.',
    body: intro('Markets', [
      'Sortable tables of the 250 largest cryptocurrencies, more than 100 large US-listed stocks and 50 major ETFs, with price, market cap and how far each has moved over a day, a week, a month and a year.',
    ]),
  },
  {
    path: '/heatmap/',
    file: 'heatmap/index.html',
    view: 'heatmap',
    title: 'Heat map and bubble map: what is moving · Market Check',
    description:
      'A live heat map and bubble map of crypto, Solana tokens, US stocks and ETFs. Size shows market cap or the size of the move; colour shows direction.',
    body: intro('Heat map', [
      'A live picture of the market. Each bubble or tile is one coin, stock or fund: its size shows market cap or how far it has moved, and its colour shows whether it is up or down.',
    ]),
  },
  {
    path: '/portfolio/',
    file: 'portfolio/index.html',
    view: 'portfolio',
    title: 'Portfolio and watchlist · Market Check',
    description:
      'Track what you hold and what you watch: live value, day change and profit or loss across stocks, ETFs and crypto. Kept in your browser, or with your account when you sign in.',
    body: intro('Portfolio and watchlist', [
      'Add what you hold to see its live value, how it moved today and your profit or loss. Add anything else to your watchlist. Your lists stay in this browser, or follow your account when you sign in.',
    ]),
  },
  {
    path: '/news/',
    file: 'news/index.html',
    view: 'news',
    title: 'Market headlines: finance, crypto, technology and AI · Market Check',
    description:
      'Recent headlines from major publishers on markets, crypto, the economy, technology and AI, gathered from public RSS feeds with source and time.',
    body: intro('Headlines', [
      'Recent headlines on markets, crypto, the economy, technology and AI, gathered from the public RSS feeds of major publishers. Each links to the original story.',
    ]),
  },
];

const STATIC_META: Record<string, { title: string; description: string }> = {
  about: {
    title: 'About · Market Check',
    description:
      'About Market Check on marketcheck.money: a free dashboard of crypto, stock and commodity prices. Not MarketCheck cars and not a brokerage.',
  },
  sources: {
    title: 'Sources and methods · Market Check',
    description:
      'Where Market Check gets its prices and headlines, how often they refresh, how each change is measured and what the limits are.',
  },
  privacy: {
    title: 'Privacy · Market Check',
    description:
      'What Market Check on marketcheck.money stores, what it does not, and which third parties are involved (Cloudflare, Google Analytics, Google AdSense).',
  },
  terms: {
    title: 'Terms · Market Check',
    description:
      'Terms of use for Market Check on marketcheck.money. Information only; third-party data may be delayed or wrong; not financial advice.',
  },
  contact: {
    title: 'Contact · Market Check',
    description: 'How to reach Market Check on marketcheck.money.',
  },
};

export function sitePages(opts: { content: Record<string, string> }): Page[] {
  const pages = [...APP_PAGES];
  for (const [name, meta] of Object.entries(STATIC_META)) {
    const body = opts.content[name];
    if (!body) continue;
    pages.push({
      path: `/${name}/`,
      file: `${name}/index.html`,
      view: 'static',
      title: meta.title,
      description: meta.description,
      body: `<article class="prose">${body}</article>`,
    });
  }
  pages.push({
    path: '/404.html',
    file: '404.html',
    view: 'notfound',
    title: 'Page not found · Market Check',
    description: 'That page does not exist.',
    index: false,
    body: `<section class="page-intro notfound"><p class="eyebrow">404</p><h1>That page isn’t here</h1><p>The address may be mistyped, or the page may have moved.</p><p><a class="btn btn-primary" href="/">Go to the dashboard</a></p></section>`,
  });
  return pages;
}

const JSON_LD = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Market Check","url":"${SITE}/","logo":"${SITE}/market-check-logo.png","description":"Free market dashboard for crypto, stocks, ETFs, commodities and headlines on marketcheck.money."}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebApplication","name":"Market Check","url":"${SITE}/","applicationCategory":"FinanceApplication","operatingSystem":"Web","browserRequirements":"Requires JavaScript for live prices","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},"description":"A free dashboard showing crypto prices, US stock and ETF prices, commodities and public news headlines, with a watchlist and portfolio tracker. Data from public third-party sources and may be delayed. Not a brokerage."}</script>`;

export function documentHtml(
  page: Page,
  assets: { js: string; css: string; adsenseClient: string },
): string {
  const url = page.path === '/404.html' ? `${SITE}/` : `${SITE}${page.path}`;
  const nav: NavId | null = page.view === 'static' || page.view === 'notfound' ? null : page.view;
  const title = esc(page.title);
  const desc = esc(page.description);
  const adsense = /^ca-pub-\d+$/.test(assets.adsenseClient)
    ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${assets.adsenseClient}" crossorigin="anonymous"></script>`
    : '';
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${GA_ID}');
</script>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${title}</title>
<meta name="description" content="${desc}" />
<meta name="robots" content="${page.index === false ? 'noindex' : 'index,follow'}" />
<link rel="canonical" href="${url}" />
<meta name="theme-color" content="#080a0f" />
<script>try{var t=localStorage.getItem('mc-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
<link rel="preload" href="/fonts/inter-400.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="/fonts/inter-600.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="${assets.css}" />
<link rel="icon" type="image/png" href="/favicon.png?v=6" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=6" />
<link rel="manifest" href="/site.webmanifest" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Market Check" />
<meta property="og:url" content="${url}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:image" content="${SITE}/og-share.png?v=6" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="Market Check logo" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" />
<meta name="twitter:image" content="${SITE}/og-share.png?v=6" />
${page.path === '/' ? JSON_LD : ''}
${adsense}
</head>
<body>
<a class="skip" href="#view">Skip to content</a>
<div id="app" data-view="${page.view}">
  <div class="tickerbar" id="ticker" aria-label="Latest headlines"></div>
  <header class="topbar" id="topbar">${topbarHtml(nav)}</header>
  <main id="view" class="view view-${page.view}" tabindex="-1">${page.body}</main>
  <footer class="foot" id="foot">${footerHtml()}</footer>
  <nav class="tabbar" id="tabbar" aria-label="Sections">${tabbarHtml(nav)}</nav>
</div>
<script type="module" src="${assets.js}"></script>
</body>
</html>
`;
}
