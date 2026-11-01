/**
 * The list of pages and the HTML document around each one. Bundled and run by
 * scripts/build.mjs at build time; nothing here runs in the browser.
 */
import { footerHtml, tabbarHtml, topbarHtml, type NavId } from './shell';
import { PODCAST_SHOWS, TOPICS } from '../../functions/_shared/newsTopics';

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
  /**
   * App pages only: a written guide shown below the live view ("how to read this page").
   * It sits outside <main>, so it stays when the app takes over, and is hidden
   * when the visitor moves to a different app page without a reload.
   */
  guide?: string;
};

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Intro block for an app page: real text for crawlers and for the moment before the app paints. */
function intro(h1: string, paragraphs: string[]): string {
  return `<section class="page-intro"><h1>${h1}</h1>${paragraphs.map((p) => `<p>${p}</p>`).join('')}</section>
<noscript><p class="page-intro">This page needs JavaScript to load live prices.</p></noscript>`;
}

/** Guide block under an app page: original text that explains the page, with links to the longer guides. */
function guide(h2: string, html: string): string {
  return `<h2>${h2}</h2>${html}`;
}

const APP_PAGES: Page[] = [
  {
    path: '/',
    file: 'index.html',
    view: 'overview',
    title: 'Market Check — Live crypto, stocks, commodities & headlines',
    description:
      'Market Check: free live crypto, stock, ETF, index and commodity prices with headlines that move them. Track a watchlist and portfolio. Not financial advice.',
    body: intro('Market Check', [
      'A free dashboard of live market prices and the headlines that move them: crypto, US stocks and ETFs, indexes, gold, silver and oil, on one page.',
      'See what is moving right now, follow your own watchlist and portfolio, and pick the tiles you care about. Data comes from public third-party sources and may be delayed. Not financial advice.',
    ]),
    guide: guide(
      'How to use this dashboard',
      `<p>The overview is built to answer one question quickly: <em>what is the market doing right now, and does any of it affect me?</em> Read it from top to bottom.</p>
      <ul>
        <li><strong>Top tiles</strong> show a handful of headline prices, such as bitcoin, the S&amp;P 500 and gold, with the change since the previous close (or over the last 24 hours for crypto). Signed-in visitors can choose which six appear.</li>
        <li><strong>Indexes</strong> below them give the broad picture for US stocks. When all of them move together, the move is about the market as a whole; when they split, it is usually about one sector. <a href="/learn/stocks-etfs-indexes/">How the indexes differ</a>.</li>
        <li><strong>Movers</strong> list the biggest gainers and losers over the window you choose. Coins that barely trade, stablecoins and wrapped tokens are filtered out, so a mover has real money behind it.</li>
        <li><strong>The pulse strip</strong> shows market breadth, the <a href="/learn/crypto-fear-and-greed/">Crypto Fear &amp; Greed Index</a> and the dates coming up: holidays, early closes and Federal Reserve decisions. <a href="/learn/market-hours/">Why those dates matter</a>.</li>
        <li><strong>The brief</strong> sums up the day in a few sentences, and tells you what has changed since your last visit.</li>
      </ul>
      <p>Click any price to open the asset, with its chart and its own changes over several windows. The percentage next to a price always has a window: a stock's 1D is measured from the previous official close, while a coin's 24h is a rolling window. <a href="/learn/price-changes/">How each change is measured</a>.</p>
      <p>Every figure comes from public third-party data and can be delayed; the time of the latest update is at the top of the page. Nothing here is a recommendation. New to any of this? Start with the <a href="/learn/">Learn guides</a> or the <a href="/faq/">FAQ</a>.</p>`,
    ),
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
    guide: guide(
      'How to read the markets tables',
      `<p>The tables list three different universes, each sorted by size by default. Click any column heading to sort by it instead, and click a row to open the asset.</p>
      <ul>
        <li><strong>Crypto</strong>: the 250 largest cryptocurrencies by market cap, from CoinGecko. Changes are rolling windows (1h, 24h, 7d, 30d, 1y) because crypto trades around the clock.</li>
        <li><strong>Stocks</strong>: more than 100 large US-listed companies. Changes are measured from official closing prices: 1D from the previous session, 1W and 1M from the close 7 and 30 days earlier.</li>
        <li><strong>ETFs</strong>: 50 major exchange-traded funds, sized by assets under management rather than market cap.</li>
      </ul>
      <p><strong>Why market cap and not price?</strong> Price alone tells you very little about size: a coin at a fraction of a cent can be worth more in total than one priced in the thousands. Market cap multiplies price by the number of shares or coins, so it is the fair way to rank. <a href="/learn/market-cap/">Market cap, explained</a>.</p>
      <p><strong>Reading the columns together.</strong> Sorting by 1D shows today's story; sorting by 1Y shows the longer one. An asset at the top of one and the bottom of the other is a reminder that a single window is rarely the whole picture. Remember that a fall of 50% needs a rise of 100% to recover. <a href="/learn/price-changes/">How changes are measured</a>.</p>
      <p>Changes are price only and do not include dividends. Figures can be delayed or differ from your broker's; see <a href="/sources/">sources and methods</a>. Nothing here is a recommendation to buy or sell.</p>`,
    ),
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
    guide: guide(
      'How to read the heat map',
      `<p>Each tile or bubble is one coin, stock or fund. Two things are encoded in it:</p>
      <ul>
        <li><strong>Colour</strong> is direction and strength: green is up, red is down, and deeper colours mean bigger moves over the window you picked.</li>
        <li><strong>Size</strong> is your choice: <em>market value</em>, so the biggest assets dominate, or <em>move</em>, so the biggest percentage changes dominate.</li>
      </ul>
      <p><strong>Start with the balance, not the biggest tile.</strong> Sized by value, one very large green tile can sit among dozens of small red ones. A value-weighted index like the S&amp;P 500 could still look fine that day, even though most companies fell. Counting green against red, or switching size to <em>move</em>, shows how broad a move really is.</p>
      <p><strong>Check the window.</strong> A stock that is red on the day can be green on the month. Changing the window is the quickest way to tell a blip from a trend.</p>
      <p><strong>Know what is left out.</strong> Stablecoins, wrapped coins and very thinly traded tokens are excluded, because their moves are either designed to be zero or are too small in money terms to mean anything. Stocks and funds come from the fixed lists on the <a href="/markets/">markets page</a>.</p>
      <p>A heat map shows <em>that</em> prices moved, not <em>why</em>, and says nothing reliable about what happens next. The full guide covers tiles versus bubbles, breadth and the questions a heat map cannot answer: <a href="/learn/heat-map/">How to read a heat map and a bubble map</a>.</p>`,
    ),
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
    guide: guide(
      'How the portfolio figures are worked out',
      `<p>Enter how many units you hold and, if you like, the average price you paid. Everything else is calculated in your browser from the latest public prices:</p>
      <ul>
        <li><strong>Value</strong> = units × latest price.</li>
        <li><strong>Today</strong> = units × (latest price − previous close). For coins, the previous close is the price 24 hours ago.</li>
        <li><strong>Gain</strong> = value − units × average cost, shown only for holdings where you entered a cost.</li>
        <li><strong>Weight</strong> = the holding's share of the total. A high weight means one asset largely decides how the whole list does.</li>
      </ul>
      <p><strong>Example.</strong> 10 shares bought at $180, closed yesterday at $195, now $198: value $1,980, today +$30, gain +$180 (+10%).</p>
      <p><strong>What is not included.</strong> Dividends, fees, taxes and cash are not counted, and the gain is unrealised until you sell. Use your broker's statements for anything official.</p>
      <p><strong>Your data stays yours.</strong> Market Check never connects to a brokerage, bank or wallet, and holdings are just numbers you type. Without an account they stay in this browser; signed in, they follow you between devices and you can delete them at any time. See the <a href="/privacy/">privacy policy</a>.</p>
      <p>Not sure whether something belongs in the portfolio or the watchlist? Use the watchlist for anything you follow but do not own, so the totals stay honest. More in <a href="/learn/portfolio-tracking/">Tracking a portfolio</a>.</p>`,
    ),
  },
  {
    path: '/news/',
    file: 'news/index.html',
    view: 'news',
    title: 'Money news by topic: markets, investing, crypto and more · Market Check',
    description:
      'Recent headlines in ten topics: markets and the economy, investing, personal finance, crypto, real estate, technology, policy, business, commodities and healthcare. From major publishers, with source and time.',
    body: intro('Headlines', [
      'Money news from major publishers, sorted into ten topics. Each story links to the original.',
      `<span class="topic-list">${TOPICS.map((t) => `<a href="/news/?topic=${t.id}">${t.label.replace(/&/g, '&amp;')}</a>`).join(' · ')}</span>`,
      'Looking for something to listen to? The <a href="/podcasts/">podcast hub</a> has shows for every one of these topics.',
    ]),
    guide: guide(
      'About these headlines',
      `<p>This page gathers recent headlines from the public feeds of major publishers and sorts them into ten topics, so you can scan a whole day of money news in one place. Each item links to the original story on the publisher's site. Market Check does not write, rewrite or summarise articles, and is not affiliated with these publishers.</p>
      <p><strong>How stories are sorted.</strong> A story is placed in a topic by the feed it came from and by the words in its headline. No single publisher fills a topic: each is limited to a few stories at a time, the same story is shown once, and stories marked as for paying subscribers only are left out where the feed says so. You can also filter by type: articles, video or podcast episodes.</p>
      <p><strong>Reading headlines well.</strong> A headline compresses a lot into a few words. Before reacting, open the story and check the actual numbers against the <a href="/markets/">prices</a>. Be wary of single-cause explanations ("stocks fell because…"), which are often written after the move. If the whole market moved, the <a href="/heatmap/">heat map</a> will show it. More tips in <a href="/learn/reading-market-news/">Reading market news</a>.</p>
      <p>A headline appearing here is not an endorsement and nothing on this page is financial advice.</p>`,
    ),
  },
  {
    path: '/podcasts/',
    file: 'podcasts/index.html',
    view: 'podcasts',
    title: 'Finance and business podcasts to browse · Market Check',
    description:
      'A hand-picked directory of podcasts on markets, investing, personal finance, crypto, real estate, technology, business, commodities and health, with the newest episode of each.',
    body: intro('Podcasts', [
      'A hand-picked directory of shows on markets, investing, personal finance, crypto, real estate, technology, business, commodities and health. Browse by topic and see the newest episode of each.',
      `Shows include ${PODCAST_SHOWS.filter((s) => s.topic).slice(0, 12).map((s) => s.name).join(', ')} and more.`,
    ]),
    guide: guide(
      'How the podcast directory works',
      `<p>Every show here was chosen by hand and filed under one of the same ten topics as the <a href="/news/">news page</a>, from markets and investing to real estate, technology and health. The aim is a short list of shows worth trying in each area rather than an exhaustive catalogue.</p>
      <p><strong>Newest episodes.</strong> Each show's recent episodes are read from its public channel feed about every twenty minutes and open on YouTube. If a feed is temporarily unavailable, the last episodes we saw are kept for a while rather than leaving a gap.</p>
      <p><strong>Choosing what to listen to.</strong> Headlines tell you what happened; long conversations are better for understanding why it might matter. Shows range from daily market wraps to long interviews and personal finance call-ins, so the topic filter is the quickest way to narrow things down.</p>
      <p>Being listed is not an endorsement of what is said in a show, and hosts' views are their own. Nothing here is financial advice. Want a show added? Email <a href="mailto:support@marketcheck.money">support@marketcheck.money</a>.</p>`,
    ),
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
  faq: {
    title: 'FAQ · Market Check',
    description:
      'Answers to common questions about Market Check: where prices come from, why they can differ from a broker, how portfolio gains are worked out, accounts and data.',
  },
  learn: {
    title: 'Learn: guides to market data · Market Check',
    description:
      'Plain guides to the numbers on Market Check: heat maps, price changes, market cap, indexes and ETFs, market hours, the Fear & Greed Index, portfolio tracking and reading news.',
  },
  'learn/heat-map': {
    title: 'How to read a heat map and a bubble map · Market Check',
    description:
      'What size and colour mean on a market heat map, tiles versus bubbles, how to spot weak breadth, and what a heat map cannot tell you.',
  },
  'learn/price-changes': {
    title: 'Price changes explained: 1h, 24h, 1D, 1W, YTD · Market Check',
    description:
      'How percentage changes are measured for crypto and stocks, rolling versus close-to-close windows, and why a price can differ from your broker.',
  },
  'learn/market-cap': {
    title: 'Market cap explained: stocks, crypto and funds · Market Check',
    description:
      'How market cap is measured for companies, cryptocurrencies and ETFs, circulating supply versus fully diluted value, and why a low price is not cheap.',
  },
  'learn/crypto-fear-and-greed': {
    title: 'The Crypto Fear & Greed Index explained · Market Check',
    description:
      'What the Crypto Fear & Greed Index measures, who publishes it, how to read the number and its limits as a sentiment gauge.',
  },
  'learn/stocks-etfs-indexes': {
    title: 'Stocks, ETFs and indexes: what is the difference? · Market Check',
    description:
      'Owning a company, owning a fund and watching an index, and how the S&P 500, Nasdaq-100 and Dow Jones Industrial Average are built.',
  },
  'learn/market-hours': {
    title: 'US market hours, holidays and Fed days · Market Check',
    description:
      'Regular, pre-market and after-hours trading, holidays and early closes, Federal Reserve decision days, options expiration and why crypto never closes.',
  },
  'learn/portfolio-tracking': {
    title: 'Tracking a portfolio: value, day change, profit or loss · Market Check',
    description:
      'The arithmetic behind a portfolio tracker: value, day change, cost basis, unrealised gain and weight, with a worked example and what it leaves out.',
  },
  'learn/reading-market-news': {
    title: 'How to read market news · Market Check',
    description:
      'Habits for reading financial headlines: check the numbers, tell reporting from opinion, distrust single-cause explanations and compare sources.',
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
${page.guide ? `  <section class="page-guide" id="page-guide" data-for="${page.view}" aria-label="About this page"><div class="prose">${page.guide}</div></section>
` : ''}  <footer class="foot" id="foot">${footerHtml()}</footer>
  <nav class="tabbar" id="tabbar" aria-label="Sections">${tabbarHtml(nav)}</nav>
</div>
<script type="module" src="${assets.js}"></script>
</body>
</html>
`;
}
