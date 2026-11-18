# Market Check

A free market dashboard: crypto, US stocks and ETFs, indexes, commodities and headlines, with a watchlist, a portfolio tracker and a layout each visitor can make their own.

- **Live site:** [marketcheck.money](https://marketcheck.money) (the official site)
- **Hosting:** Cloudflare Pages, project `market-check`
- **Support:** support@marketcheck.money

House rules for contributors and agents are in [AGENTS.md](./AGENTS.md).

## Layout

| Path | What it is |
|------|------------|
| `src/` | The browser app: TypeScript, no framework. See [docs/FRONTEND.md](./docs/FRONTEND.md) |
| `content/` | Text of the About, Sources, Privacy, Terms and Contact pages (HTML fragments) |
| `public/` | Files copied to the site as they are: icons, fonts, `ads.txt`, `robots.txt`, `_headers`, `_routes.json` |
| `functions/` | Cloudflare Pages Functions, served at `/api/*`, plus `_middleware.ts` |
| `scripts/` | `build.mjs` (build), `dev.mjs` (local server), `mock-upstream.mjs` (generated data), `test/` (checks) |
| `docs/` | Notes on how the front end is put together; `docs/archive/` holds notes from the first version |
| `dist/` | Build output. Not committed |
| `wrangler.toml` | Pages config and the `LAYOUTS` KV binding |

## Pages

`/` overview (with Yesterday's best buys) · `/markets/` tables · `/heatmap/` bubble map (with an optional physics mode) and heat map · `/compare/` up to five assets side by side · `/portfolio/` portfolio, history and watchlist · `/news/` headlines in ten topics · `/about/` `/sources/` `/privacy/` `/terms/` `/contact/` text pages. Each is a real HTML file, so each can be indexed and shared. `/?q=AAPL` opens one symbol; `/quote/AAPL` redirects there.

## Local development

```bash
npm ci
npm run dev        # http://127.0.0.1:5173 with the real Functions and live upstream data
npm run dev:mock   # the same with generated data: works offline, and stock prices keep "moving"
npm run build      # production build -> dist/
npm run check      # type-check and run the tests
```

With the dev server running, `http://127.0.0.1:5173/__dev/login` signs you in as a test user (no OAuth needed) and `/__dev/logout` signs out. Saved layouts live in memory until the server stops.

`npm run pages:dev` serves `dist/` through wrangler, which is the closest match to production.

Copy `.env.example` to `.env` for optional build-time settings. `.env` is gitignored. No setting is required: a clean clone builds the site exactly as it is published.

## Tests

`npm test` runs everything in `scripts/test/`:

| Check | What it guards |
|-------|----------------|
| `calendar` | Market hours, holidays and early closes against the exchanges' published dates |
| `api` | The data endpoints against generated upstream data: movers never include thinly traded coins, each change is measured over the window it is labelled with, the 20-symbol cap, candles that hold their open and close, Yesterday's best buys, and how little is written to KV |
| `pack` | Bubble maps fill their box and never overlap |
| `treemap` | Heat map tiles cover their box exactly |
| `stats` | Moving averages, volatility, worst drop, correlation, portfolio totals, and the dates and rules of Yesterday's best buys |
| `game` | Rules of the daily call |
| `board` | The leaderboard: a record cannot be faked from the browser, results and ranking |
| `history` | The hourly price record behind 4h and 8h crypto changes |
| `news` | The ten news topics, where each old category went, and feed limits |

## Deploy

```bash
npm ci && npm run build && npx wrangler pages deploy dist --project-name=market-check
```

See [DEPLOY.md](./DEPLOY.md) for preview deployments, settings and secrets.

## Data sources

CoinGecko (crypto), Yahoo Finance (stocks, ETFs, indexes, commodities), Nasdaq (fund sizes), Jupiter (Solana tokens), alternative.me (Crypto Fear & Greed) and publishers' RSS feeds (headlines). No API keys. What each endpoint does, how long it is cached and how each change is measured is described for visitors on [/sources/](https://marketcheck.money/sources/) and for developers at the top of each file in `functions/`.

CoinGecko limits its free API by address, and Cloudflare's outgoing addresses are shared, so the server is sometimes refused (HTTP 429) through no fault of its own. When that happens the server answers from its last good copy, and a browser that gets nothing asks CoinGecko directly (`refreshCrypto` in `src/data/market.ts`). Setting a free CoinGecko demo key as the secret `COINGECKO_API_KEY` is optional: it is used only to retry a refused request.

The Ethereum tab has its own list (CoinGecko's `ethereum-ecosystem` category) and three ways to fill it, tried in order by `loadEth` in `src/data/market.ts`: the server (`/api/cryptos?universe=eth`, with a last good copy in KV); CoinGecko asked from the browser; and `ethFromMain()` in `functions/_shared/cryptoUniverse.ts`, which picks the known Ethereum tokens out of the main list. The server uses that last one too when it has nothing better, and marks the answer `partial: true`; the browser then still tries CoinGecko for the full list. A partial list shows fewer tokens and the page says so.

Data is cached in the Cloudflare Cache API, not in KV. KV (`LAYOUTS`) holds only what belongs to a signed-in visitor, sign-in codes, and a rare last-good snapshot of the big lists (coins, Ethereum tokens, share counts). The free plan allows 1,000 KV writes a day, so keep it that way.

## News topics

`functions/_shared/newsTopics.ts` is the one place that defines the ten topics and the content types (article or video). Which feeds belong to which topic is in `functions/_shared/rssHeadlines.ts` (`FEEDS_BY_CAT`). The ids of the old categories (`tradfi`, `housing`, `ai` and so on) are still accepted and mapped to the topic that replaced them.

How a story gets into a topic, in `rssHeadlines.ts`:

- A feed marked `trustedTopic` is about the topic and everything in it is taken. A general feed (a whole business or politics desk) has a `keywordFilter`; with `matchTitle` the headline itself has to match, not a word somewhere in the summary.
- `dedupeSort` keeps one copy of a story (same link, or same headline from the same outlet) and drops one- and two-word headlines, which are programme pages.
- `spreadBySource` limits each outlet to 4 written stories and each channel to 2 videos per topic, loosening a little only when a topic would otherwise be short. "NYT Business" and "NYT DealBook" count as one outlet (`outletOf`).
- The answer lists `feedsUsed`, `feedsQuiet` (answered, nothing on topic just now: normal) and `feedsFailed` (could not be read: worth a look if it persists). `npm run smoke` prints all three.

MarketWatch (the Dow Jones news site) is a source in Investing, Personal Finance and Commodities. An earlier note said never to use its feeds because the site once went by a similar name; the owner lifted that on 2026-10-11.

## Charts and libraries

The charts use a few small open-source libraries, bundled with the app: D3 modules (`d3-scale`, `d3-shape`, `d3-array`, `d3-time`, `d3-interpolate`) for scales, calendar ticks and line shapes; anime.js for the entrance of Yesterday's best buys; and Matter.js for the bubble map's physics mode, which loads as its own file only when a visitor turns it on (`splitting` in `scripts/build.mjs`).

- `src/ui/chart.ts` draws every price chart: line or candles, volume, moving averages (from a longer `history` than is shown), compare lines in percent, and press-and-drag measuring.
- `src/data/history.ts` loads series: Yahoo through `/api/chart` (which now also returns `opens`, `highs`, `lows`), and CoinGecko from the browser. A coin uses its Yahoo pair only when the prices agree (`verifiedPair`).
- `src/lib/stats.ts` holds the maths, tested in `scripts/test/stats.test.mjs`.
- `/api/yesterday` (`functions/_shared/bestBuys.ts`) builds Yesterday's best buys from the whole market. Stocks: Yahoo's stock screener (cookie and crumb from `fc.yahoo.com`, one query for every US-listed share that rose, one to count them; the session is read from each row's time and refused while it is still trading), else Nasdaq's full list, which can lag by a session or more (the session it shows is worked out from the largest companies' Yahoo closes). The biggest gainers are measured again from Yahoo's daily closes, forty at a time until ten pass, because the screeners' previous closes are sometimes wrong; one Yahoo has no bar for is left out. Crypto: Yahoo's list of every coin (about 11 pages of 250, CoinMarketCap prices) gives each coin's last 00:00 UTC close; those closes are saved once a day (`best:closes:<day>`) and the next day's are compared with them. When the day before's were not saved (the first day, or a day nobody visited), each coin's start is read from Yahoo's daily bars, 560 coins a request over about four requests a minute apart, the progress in `best:fill:<day>`. Yahoo rounds daily bars to six decimals, so coins under $0.001 use hourly bars (`COIN_MICRO`). The biggest coin gainers are checked against Yahoo's bars, twenty at a time until ten pass. A list with fewer than five is never saved. CoinPaprika and CoinGecko sit behind Cloudflare and often refuse Functions, which reach them from shared addresses; Yahoo and Nasdaq do not, so CoinPaprika is not used. Each list is saved once (`best:v2:<group>:<day>`), at most one is worked out per request (the one tried longer ago goes first), sources are looked at no more than every 20 minutes while a list is missing (every minute while coins are being read), a pending group carries the reason in `why`, and the big lists are read without a full JSON parse (CPU). About three KV writes a day (a few more on a day that needs the daily bars). It is batchable.

## Daily call leaderboard

Calls are refereed on the server (`functions/_shared/game.ts`, `reconcileGame`): only a call that arrives while its session is still open is marked verified, and the server settles it from the index's closes. A player's line lives in the metadata of a KV key `board:<account>`, written about once per trading day per player; the board itself is one `list` call, cached five minutes.

## 4h and 8h crypto changes (off by default)

CoinGecko has no 4h or 8h figures. `functions/_shared/cryptoHistory.ts` can work them out from an hourly record of prices kept in KV, but the record is only complete if the site is loaded at least once an hour around the clock. It is off unless the Pages variable `PRICE_HISTORY` is `1`. The 4h and 8h buttons appear on the site by themselves when figures exist.

## `/api/markets` chunking

Cloudflare Workers limit subrequests per invocation, so quote requests are split into chunks:

- **Client:** requests chunks of **15** symbols (`MARKETS_CHUNK` in `src/data/market.ts`).
- **Server:** `functions/api/markets.ts` caps each request at **20** symbols.

## Disclaimer

Not financial advice. Market data may be delayed or unavailable.

## News leaderboard (`/api/newsboard`)

Ranks news stories per topic (the ten in `functions/_shared/newsTopics.ts`) by popularity instead of recency.

`GET /api/newsboard?topic=<id>&board=live|today|yesterday|day&date=YYYY-MM-DD&sweep=1`

- **live**: stories from the last 24 hours, older ones fade (half-life 18 h).
- **today**: stories released today (New York time). Provisional until the noon check, then locked (`status: final`).
- **yesterday**: the final top 10 of the previous day. **day** returns the stored final for `date` plus `days`, the dates available.
- Day boundaries and noon use America/New_York.

**Signals** (scoring constants sit at the top of `functions/_shared/newsBoard.ts`): outlet coverage, Hacker News (one Algolia request shared by all topics), Reddit (one `top.json` request per topic; often refused from cloud addresses, then the signal shows as not ok), Google Trends daily trending searches (five countries, one request each), and Wikipedia's most-read articles of the previous UTC day (one request, cached 3 hours, matched to a story by article title). Each is cached 20 to 30 minutes (Wikipedia 3 hours); a failed signal never fails the board, and its reason is shown in the "How ranking works" dialog (`error` in `signals[]`).

Reddit needs an app key from cloud servers: create a "script" app at reddit.com/prefs/apps and set `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` as Cloudflare Pages secrets. Without them the unsigned request is tried and usually refused.

The stories come from `/api/headlines?topic=<id>&pool=1`, fetched as one subrequest so the board stays well under the 50-subrequest limit. A board request makes at most 9 fetches (headlines, Hacker News, Reddit, Wikipedia, five Trends geos; plus one token request when Reddit is keyed, or a second Wikipedia day) plus a few KV reads.

**KV** (`LAYOUTS`, keys `newsboard:v1:`, 14-day expiry): `acc:<ETdate>:<topic>` (stories seen that day with their best signals, written at most once an hour per topic), `noon:<ETdate>:<topic>`, `final:<ETdate>:<topic>`, `days:<topic>` (index of finals). Without KV (local dev) an in-memory map is used.

**Sweeps**: `.github/workflows/newsboard-sweep.yml` calls `board=live&sweep=1` for every topic around New York midnight and noon (and twice more), so snapshots are written even on quiet days. `sweep=1` skips the response cache. Local data: `npm run dev:mock`.

