# Deploy

Market Check runs on **Cloudflare Pages**: the static site in `dist/` plus the Pages Functions in `functions/`. The Pages project is `market-check` and the site is served at **marketcheck.money**.

## Requirements

- Node 20 or newer
- `wrangler` logged in to the Cloudflare account that owns the `market-check` project (`npx wrangler login`)

## Production deploy

```bash
npm ci
npm run check                # optional: type-check and tests
npm run build                # writes dist/
npx wrangler pages deploy dist --project-name=market-check --branch=main
```

`npm run deploy` does the build and the deploy in one step.

No build settings are needed. The AdSense publisher id is built in (`scripts/build.mjs`, and `public/ads.txt`); set `VITE_ADSENSE_CLIENT` only to override it.

## Preview deploy

To look at a change with real data before it goes live, deploy it to a branch alias:

```bash
npm run build
npx wrangler pages deploy dist --project-name=market-check --branch=preview-redesign
```

This is served at `https://preview-redesign.market-check.pages.dev`. Normally every `*.pages.dev` address redirects to marketcheck.money; `functions/_middleware.ts` makes an exception for branch names that start with `preview` or `redesign`, and marks those responses `noindex`.

Sign-in is not expected to work on a preview address: the Google and Microsoft sign-in settings only allow marketcheck.money, and Pages keeps separate secrets for previews. Everything else works, including saving a watchlist and portfolio in the browser.

## Settings and secrets

`wrangler.toml` binds the KV namespace `LAYOUTS`. Secrets are set in the Cloudflare dashboard (Workers & Pages → market-check → Settings → Variables and secrets) or with `wrangler pages secret put`. They never go in the repo. `.env.example` lists the names.

| Name | Used for |
|------|----------|
| `SESSION_SECRET` | Signing the sign-in cookie |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign in with Google |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Sign in with Microsoft |
| `RESEND_API_KEY`, `MAGIC_FROM_EMAIL` | Emailing sign-in codes |
| `PUBLIC_ORIGIN` | `https://marketcheck.money` |
| `COINGECKO_API_KEY` | Optional. A free CoinGecko demo key, used only to retry when CoinGecko refuses the keyless request |

## What the hosting files do

- `public/_routes.json` keeps requests for scripts, styles, fonts and images away from Functions, so they do not count against the daily Functions allowance. Pages and `/api/*` still go through `functions/_middleware.ts`.
- `public/_headers` sets caching. Files under `/assets/` have a hash in their name and are cached for a year.
- `dist/404.html` is written by the build. Its presence tells Pages to answer unknown addresses with a real 404 instead of the home page.
- `dist/sitemap.xml` is written by the build from the page list in `src/site/pages.ts`.

## After a deploy

1. Open https://marketcheck.money/ and check that prices load and the time in the footer is recent.
2. Open `/markets/`, `/heatmap/`, `/portfolio/`, `/news/` and one text page.
3. `https://marketcheck.money/ads.txt` and `/robots.txt` still answer.
4. Sign in and check that your tiles and lists are there.

`npm run smoke` runs these checks from the command line (`node scripts/smoke-live.mjs <address>` for another address).

## Rolling back

Every deploy stays available in the Cloudflare dashboard (Workers & Pages → market-check → Deployments). To go back, open an earlier deployment and choose **Rollback to this deployment**. Per the house rules, fix forward with a new commit instead of reverting history.
