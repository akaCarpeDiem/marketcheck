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

`/` overview · `/markets/` tables · `/heatmap/` bubble map and heat map · `/portfolio/` portfolio and watchlist · `/news/` headlines · `/about/` `/sources/` `/privacy/` `/terms/` `/contact/` text pages. Each is a real HTML file, so each can be indexed and shared. `/?q=AAPL` opens one symbol; `/quote/AAPL` redirects there.

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

## Deploy

```bash
npm ci && npm run build && npx wrangler pages deploy dist --project-name=market-check
```

See [DEPLOY.md](./DEPLOY.md) for preview deployments, settings and secrets.

## Data sources

CoinGecko (crypto), Yahoo Finance (stocks, ETFs, indexes, commodities), Nasdaq (fund sizes), Jupiter (Solana tokens), alternative.me (Crypto Fear & Greed) and publishers' RSS feeds (headlines). No API keys. What each endpoint does, how long it is cached and how each change is measured is described for visitors on [/sources/](https://marketcheck.money/sources/) and for developers at the top of each file in `functions/`.

Data is cached in the Cloudflare Cache API, not in KV. KV (`LAYOUTS`) holds only what belongs to a signed-in visitor, sign-in codes, and a rare last-good snapshot of the two big lists. The free plan allows 1,000 KV writes a day, so keep it that way.

## `/api/markets` chunking

Cloudflare Workers limit subrequests per invocation, so quote requests are split into chunks:

- **Client:** requests chunks of **15** symbols (`MARKETS_CHUNK` in `src/data/market.ts`).
- **Server:** `functions/api/markets.ts` caps each request at **20** symbols.

## Disclaimer

Not financial advice. Market data may be delayed or unavailable.
