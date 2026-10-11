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

`/` overview · `/markets/` tables · `/heatmap/` bubble map and heat map · `/portfolio/` portfolio and watchlist · `/news/` headlines in ten topics · `/podcasts/` podcast directory · `/about/` `/sources/` `/privacy/` `/terms/` `/contact/` text pages. Each is a real HTML file, so each can be indexed and shared. `/?q=AAPL` opens one symbol; `/quote/AAPL` redirects there.

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
| `api` | The data endpoints against generated upstream data: movers never include thinly traded coins, each change is measured over the window it is labelled with, the 20-symbol cap, and how little is written to KV |
| `pack` | Bubble maps fill their box and never overlap |
| `treemap` | Heat map tiles cover their box exactly |
| `game` | Rules of the daily call |
| `board` | The leaderboard: a record cannot be faked from the browser, results and ranking |
| `history` | The hourly price record behind 4h and 8h crypto changes |
| `news` | The ten news topics, where each old category went, feed limits, the podcast directory |

## Deploy

```bash
npm ci && npm run build && npx wrangler pages deploy dist --project-name=market-check
```

See [DEPLOY.md](./DEPLOY.md) for preview deployments, settings and secrets.

## Data sources

CoinGecko (crypto), Yahoo Finance (stocks, ETFs, indexes, commodities), Nasdaq (fund sizes), Jupiter (Solana tokens), alternative.me (Crypto Fear & Greed) and publishers' RSS feeds (headlines). No API keys. What each endpoint does, how long it is cached and how each change is measured is described for visitors on [/sources/](https://marketcheck.money/sources/) and for developers at the top of each file in `functions/`.

CoinGecko limits its free API by address, and Cloudflare's outgoing addresses are shared, so the server is sometimes refused (HTTP 429) through no fault of its own. When that happens the server answers from its last good copy, and a browser that gets nothing asks CoinGecko directly (`refreshCrypto` in `src/data/market.ts`). Setting a free CoinGecko demo key as the secret `COINGECKO_API_KEY` is optional: it is used only to retry a refused request.

The Ethereum tab has its own list (CoinGecko's `ethereum-ecosystem` category) and three ways to fill it, tried in order by `loadEth` in `src/data/market.ts`: the server (`/api/cryptos?universe=eth`, with a last good copy in KV); CoinGecko asked from the browser; and `ethFromMain()` in `functions/_shared/cryptoUniverse.ts`, which picks the known Ethereum tokens out of the main list already on the page. The last one shows fewer tokens and the page says so.

Data is cached in the Cloudflare Cache API, not in KV. KV (`LAYOUTS`) holds only what belongs to a signed-in visitor, sign-in codes, and a rare last-good snapshot of the big lists (coins, Ethereum tokens, share counts). The free plan allows 1,000 KV writes a day, so keep it that way.

## News topics and podcasts

`functions/_shared/newsTopics.ts` is the one place that defines the ten topics, the content types (article, video, podcast) and the podcast directory. Which feeds belong to which topic is in `functions/_shared/rssHeadlines.ts` (`FEEDS_BY_CAT`). To add a show to the podcast hub, add a line to `PODCAST_SHOWS` with its YouTube channel id. The ids of the old categories (`tradfi`, `housing`, `ai` and so on) are still accepted and mapped to the topic that replaced them.

How a story gets into a topic, in `rssHeadlines.ts`:

- A feed marked `trustedTopic` is about the topic and everything in it is taken. A general feed (a whole business or politics desk) has a `keywordFilter`; with `matchTitle` the headline itself has to match, not a word somewhere in the summary.
- `dedupeSort` keeps one copy of a story (same link, or same headline from the same outlet) and drops one- and two-word headlines, which are programme pages.
- `spreadBySource` limits each outlet to 4 written stories and each channel to 2 videos per topic, loosening a little only when a topic would otherwise be short. "NYT Business" and "NYT DealBook" count as one outlet (`outletOf`).
- The answer lists `feedsUsed`, `feedsQuiet` (answered, nothing on topic just now: normal) and `feedsFailed` (could not be read: worth a look if it persists). `npm run smoke` prints all three.

MarketWatch (the Dow Jones news site) is a source in Investing, Personal Finance and Commodities. An earlier note said never to use its feeds because the site once went by a similar name; the owner lifted that on 2026-10-11.

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
