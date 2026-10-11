# Market Check SEO / host fix — 2026-09-27

Brand stays **Market Check**. Canonical host stays **marketcheck.money**. Built from `/workspace/market-check`, deployed to Cloudflare Pages project **`market-check`** (serves marketcheck.money).

## What was fixed

| Issue | Fix |
|-------|-----|
| robots.txt Sitemap → pages.dev | → `https://marketcheck.money/sitemap.xml` |
| sitemap.xml listed pages.dev only | Lists only `https://marketcheck.money/` paths (`/`, `/about/`, `/privacy/`, `/terms/`, `/contact/`) |
| Homepage empty SPA for crawlers | Crawlable `.seo-intro` block in `index.html` with H1 “Market Check”, coverage, disclaimer, legal links (JS `#app` unchanged) |
| `/about/` was SPA fallback | Real static `public/about/index.html` |
| Contact used `support@marketcheck.money` | Removed. GitHub kept. Copy says email not published yet; constant `PUBLISHER_EMAIL` in `src/publisher.ts` (empty) |
| Legal meta said pages.dev | Privacy/Terms say “Applies to marketcheck.money” |
| `ads.txt` returned SPA HTML | Real `public/ads.txt` (comments only; no fake pub ID) |
| AdSense | Still inactive until `VITE_ADSENSE_CLIENT` is set — unchanged |
| pages.dev did not 301 | `functions/_middleware.ts` 301s `*.pages.dev` and `www.marketcheck.money` → matching `https://marketcheck.money` path |
| Dashboard disclaimer thin | Footer: third-party/delayed data, not advice, not brokerage/exchange/advisor/bank + About link |

## Public URLs (live)

| URL | Canonical | Notes |
|-----|-----------|-------|
| https://marketcheck.money/ | https://marketcheck.money/ | H1 in view-source; JS dashboard |
| https://marketcheck.money/about/ | https://marketcheck.money/about/ | Real about page |
| https://marketcheck.money/privacy/ | https://marketcheck.money/privacy/ | |
| https://marketcheck.money/terms/ | https://marketcheck.money/terms/ | |
| https://marketcheck.money/contact/ | https://marketcheck.money/contact/ | GitHub; no example.com |
| https://marketcheck.money/robots.txt | — | Sitemap → marketcheck.money |
| https://marketcheck.money/sitemap.xml | — | marketcheck.money URLs only |
| https://marketcheck.money/ads.txt | — | text/plain, comments only |
| https://market-check.pages.dev/* | — | **301** → https://marketcheck.money/* |
| https://www.marketcheck.money/* | — | **301** → https://marketcheck.money/* |

## AdSense status

**Inactive.** `VITE_ADSENSE_CLIENT` unset → no `adsbygoogle` script, no ad slots rendered (`src/ads.ts`). `/ads.txt` is comments-only until a real `pub-` ID exists. Do not invent a publisher ID.

## Contact status

- GitHub:  (kept)
- Email: **not published** (no example.com)
- Set email in one place: `src/publisher.ts` → `PUBLISHER_EMAIL` (also update `public/contact/index.html` when publishing)
- No contact form (not required)

## Deploy

```bash
cd /workspace/market-check
npm run build
npx wrangler pages deploy dist --project-name=market-check
# Legacy alias host (redirect via middleware):
```

Production deployment (this fix): `https://fd6fecf0.market-check.pages.dev` → custom domain marketcheck.money.

## Still unfinished / follow-ups

1. **Publisher email** — still empty; publish a real inbox in `PUBLISHER_EMAIL` + contact page when ready.
2. **AdSense** — still off; when approved, set `VITE_ADSENSE_CLIENT` at build time and replace `/ads.txt` comments with the real line.
3. **i18n language switch** — a prior dist-only deploy on marketcheck.money included multi-language UI (`legal-page` / locale bundles) that is **not** in the `/workspace/market-check` source tree. This rebuild restores the repo source product (no lang switch). Re-introduce i18n in source if that feature must return.
4. **Git push** — local repo has many uncommitted changes; this task did not push to GitHub.

## Honest claims (kept)

Does **not** claim bank-level accuracy, AI-powered picks, or guaranteed profit. Sources named as CoinGecko / Yahoo / public RSS. Explicitly not a broker, exchange, advisor, or bank.
