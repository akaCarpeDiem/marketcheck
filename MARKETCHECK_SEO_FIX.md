# Market Check SEO / host fix — 2026-09-27

Brand stays **Market Check**. Canonical host stays **marketcheck.fun**. Built from `/workspace/market-check`, deployed to Cloudflare Pages project **`market-check`** (serves marketcheck.fun). Same build also deployed to legacy project **`market-clock`** so `market-clock-aos.pages.dev` 301s. Deploy mirrors synced: `/workspace/market-check-deploy`, `/workspace/market-check-pages`.

## What was fixed

| Issue | Fix |
|-------|-----|
| robots.txt Sitemap → pages.dev | → `https://marketcheck.fun/sitemap.xml` |
| sitemap.xml listed pages.dev only | Lists only `https://marketcheck.fun/` paths (`/`, `/about/`, `/privacy/`, `/terms/`, `/contact/`) |
| Homepage empty SPA for crawlers | Crawlable `.seo-intro` block in `index.html` with H1 “Market Check”, coverage, disclaimer, legal links (JS `#app` unchanged) |
| `/about/` was SPA fallback | Real static `public/about/index.html` |
| Contact used `support@marketcheck.fun` | Removed. GitHub kept. Copy says email not published yet; constant `PUBLISHER_EMAIL` in `src/publisher.ts` (empty) |
| Legal meta said pages.dev | Privacy/Terms say “Applies to marketcheck.fun” |
| `ads.txt` returned SPA HTML | Real `public/ads.txt` (comments only; no fake pub ID) |
| AdSense | Still inactive until `VITE_ADSENSE_CLIENT` is set — unchanged |
| pages.dev did not 301 | `functions/_middleware.ts` 301s `*.pages.dev` and `www.marketcheck.fun` → matching `https://marketcheck.fun` path |
| Dashboard disclaimer thin | Footer: third-party/delayed data, not advice, not brokerage/exchange/advisor/bank + About link |

## Public URLs (live)

| URL | Canonical | Notes |
|-----|-----------|-------|
| https://marketcheck.fun/ | https://marketcheck.fun/ | H1 in view-source; JS dashboard |
| https://marketcheck.fun/about/ | https://marketcheck.fun/about/ | Real about page |
| https://marketcheck.fun/privacy/ | https://marketcheck.fun/privacy/ | |
| https://marketcheck.fun/terms/ | https://marketcheck.fun/terms/ | |
| https://marketcheck.fun/contact/ | https://marketcheck.fun/contact/ | GitHub; no example.com |
| https://marketcheck.fun/robots.txt | — | Sitemap → marketcheck.fun |
| https://marketcheck.fun/sitemap.xml | — | marketcheck.fun URLs only |
| https://marketcheck.fun/ads.txt | — | text/plain, comments only |
| https://market-clock-aos.pages.dev/* | — | **301** → https://marketcheck.fun/* |
| https://market-check.pages.dev/* | — | **301** → https://marketcheck.fun/* |
| https://www.marketcheck.fun/* | — | **301** → https://marketcheck.fun/* |

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
npx wrangler pages deploy dist --project-name=market-clock
```

Production deployment (this fix): `https://fd6fecf0.market-check.pages.dev` → custom domain marketcheck.fun.

## Still unfinished / follow-ups

1. **Publisher email** — still empty; publish a real inbox in `PUBLISHER_EMAIL` + contact page when ready.
2. **AdSense** — still off; when approved, set `VITE_ADSENSE_CLIENT` at build time and replace `/ads.txt` comments with the real line.
3. **i18n language switch** — a prior dist-only deploy on marketcheck.fun included multi-language UI (`legal-page` / locale bundles) that is **not** in the `/workspace/market-check` source tree. This rebuild restores the repo source product (no lang switch). Re-introduce i18n in source if that feature must return.
4. **Git push** — local repo has many uncommitted changes; this task did not push to GitHub.
5. Optional: retire or empty the legacy `market-clock` Pages project once traffic fully uses marketcheck.fun (redirect can remain indefinitely).

## Honest claims (kept)

Does **not** claim bank-level accuracy, AI-powered picks, or guaranteed profit. Sources named as CoinGecko / Yahoo / public RSS. Explicitly not a broker, exchange, advisor, or bank.
