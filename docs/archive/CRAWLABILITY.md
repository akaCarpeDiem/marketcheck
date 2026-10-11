# Market Check — Crawlability pass

**Date:** Sunday Sep 27, 2026 (PT)  
**Product:** Market Check (unchanged)  
**Canonical host:** https://marketcheck.money (unchanged; not migrated)  
**Pages project:** `market-check`  
**Latest production deploy:** https://abb55565.market-check.pages.dev → aliases `marketcheck.money`, `www.marketcheck.money`  
**Scope:** crawlability / SEO only — no restyle, no trading features, no rename.

---

## 1. Live robots.txt

URL: https://marketcheck.money/robots.txt

```
User-agent: *
Allow: /

Sitemap: https://marketcheck.money/sitemap.xml
```

Notes:
- No `Allow: /ads.txt` because `ads.txt` is omitted (no real AdSense publisher ID).
- Sitemap points at `marketcheck.money` only (no pages.dev).

---

## 2. Sitemap URL list (every `<loc>`)

URL: https://marketcheck.money/sitemap.xml  
`lastmod` on each entry: `2026-09-27`

| loc |
|-----|
| https://marketcheck.money/ |
| https://marketcheck.money/about/ |
| https://marketcheck.money/privacy/ |
| https://marketcheck.money/terms/ |
| https://marketcheck.money/contact/ |

Discovery notes:
- App is a single dashboard SPA at `/` (Vite + `src/main.ts`). No separate static `/markets/` or symbol HTML routes that return dedicated 200 pages.
- Indexable static HTML: homepage + about + privacy + terms + contact.
- No pages.dev URLs, no hash routes, no 404 URLs in the sitemap.
- API routes under `/api/*` are not listed (not content pages).

---

## 3. Title tags (every indexable page)

| Path | `<title>` |
|------|-----------|
| `/` | Market Check — Live crypto, stocks, commodities & headlines |
| `/about/` | About · Market Check |
| `/privacy/` | Privacy Policy · Market Check |
| `/terms/` | Terms of Use · Market Check |
| `/contact/` | Contact · Market Check |

(Ampersand in the homepage title is encoded as `&amp;` in HTML source.)

Each of the five also has: unique meta description, `canonical` → `https://marketcheck.money/...`, `og:title` / `og:description` / `og:url`, `lang="en"`.

Homepage additionally:
- Organization JSON-LD
- WebApplication JSON-LD (market quotes dashboard, free / price 0)
- Crawlable `.seo-intro` in raw HTML (what it is; crypto & equity quotes & headlines; free, no account; third-party / may be delayed; differentiation; links to about/privacy/terms/contact)

---

## 4. ads.txt — omitted (and why)

**Omitted.** Live: `https://marketcheck.money/ads.txt` → **404**.

Why:
- No real Google AdSense publisher ID in env (`VITE_ADSENSE_CLIENT` unset) or project secrets.
- Previous comment-only `public/ads.txt` was removed (do not publish fake or comment-only ads.txt).
- `robots.txt` does not `Allow: /ads.txt`.
- Middleware hard-404s `/ads.txt` (and `_redirects` also maps it to `404.html`) so a stale asset cannot soft-serve SPA HTML or resurrect comment-only text.
- When a real `ca-pub-…` / `pub-…` ID exists: set `VITE_ADSENSE_CLIENT` at build time, publish a real ads.txt line, and remove the middleware omit + `_redirects` ads.txt rule.

Privacy copy updated to say ads.txt is not published until AdSense is active.

---

## 5. Deploy confirmation — marketcheck.money

| Check | Result |
|-------|--------|
| Cloudflare Pages project | `market-check` |
| Latest deploy URL | https://abb55565.market-check.pages.dev |
| Custom domain aliases | `https://marketcheck.money`, `https://www.marketcheck.money` |
| Homepage 200 + SEO intro / JSON-LD | Yes (live verified) |
| robots.txt / sitemap.xml | Live on marketcheck.money |
| `*.pages.dev` / `www` | 301 → `https://marketcheck.money` (middleware) |
| Unknown paths (`/preview`, `/debug`, etc.) | **404** + `noindex` via `404.html` |
| Product name / host | Still **Market Check** / **marketcheck.money** |

Deploy command used:

```bash
cd /workspace/market-check
npm run build
npx wrangler pages deploy dist --project-name=market-check --commit-dirty=true
```

---

## Differentiation copy (live)

On homepage indexable section and About → “What it is not”:

- **Not** MarketCheck the car-listing / vehicle marketplace company  
- **Not** a brokerage (or exchange / advisor / bank)

---

## Files touched (this pass)

| Path | Change |
|------|--------|
| `public/robots.txt` | Allow `/` + Sitemap only (no ads.txt Allow) |
| `public/sitemap.xml` | Five marketcheck.money locs + lastmod |
| `public/ads.txt` | **Deleted** |
| `index.html` | Meta refresh, Organization + WebApplication JSON-LD, free/no-account + differentiation in `.seo-intro` |
| `public/about/index.html` | Differentiation + free/no-account; unique meta/og |
| `public/privacy/index.html` | No longer links to comment-only ads.txt |
| `public/404.html` | **Added** — noindex 404 for empty/preview/debug/unknown |
| `public/_redirects` | Hard-404 `/ads.txt`; keep `/assets/*` 404 |
| `functions/_middleware.ts` | Hard-404 `/ads.txt` until real pub ID |

Not changed: visual styles of the dashboard, trading features, product name, domain.
