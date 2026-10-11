# Market Check — Publishing layer

**Official site:** https://marketcheck.money  
**Cloudflare Pages project:** `market-check`  
**Hosting alias (optional):** `market-check.pages.dev` (Cloudflare Pages default — not the brand URL)  
**Product / brand / domain:** unchanged (Market Check · marketcheck.money)  
**Dashboard restyle:** none

---

## Legal URLs

| URL | Status | Notes |
|-----|--------|-------|
| https://marketcheck.money/privacy/ | Live | No accounts; localStorage for UI/watchlist only; Cloudflare hosting logs; third-party quote/news; Google AdSense installed (ca-pub-4059575347806121); GitHub contact (+ email when `PUBLISHER_EMAIL` set) |
| https://marketcheck.money/terms/ | Live | Informational only; third-party data may be wrong/delayed; no liability for trades; personal non-commercial use (default) |
| https://marketcheck.money/about/ | Live | Names marketcheck.money as official site; differentiation vs MarketCheck cars / brokerages |
| https://marketcheck.money/contact/ | Live | GitHub `` only; **no** fake/example emails. Inbox appears when `PUBLISHER_EMAIL` in `src/publisher.ts` is set (currently empty) |
| https://marketcheck.money/sources/ | Live | Methodology + cross-links to privacy/terms/contact/about |

Each legal page has a unique `<title>`, meta description, and `canonical` → `https://marketcheck.money/...`.

---

## Ads

| Item | Status |
|------|--------|
| AdSense live? | **Yes — head script + ads.txt for verification** (`ca-pub-4059575347806121`) |
| `VITE_ADSENSE_CLIENT` | `ca-pub-4059575347806121` (build-time `.env`) |
| `ads.txt` | Published: `google.com, pub-4059575347806121, DIRECT, f08c47fec0942fa0` |
| Placement | Labeled **Advertisement** / reserved slots **below the fold only** (footer). Nothing above the first quote row. No fake “Sponsored pick” tickers. Slot ID optional (`VITE_ADSENSE_SLOT`). |
| Head script | Exact `adsbygoogle.js?client=ca-pub-4059575347806121` in Vite `index.html` and all static legal HTML under `public/`. |

---

## Analytics

Privacy-safe **pageview** analytics only — do not send searched tickers, watchlists, or quote values.

| Path | How |
|------|-----|
| **Preferred (no code)** | Cloudflare Dashboard → Web Analytics (or Pages project analytics) for **marketcheck.money**. No build-time token. |
| **Optional beacon** | Set `VITE_CF_WEB_ANALYTICS_TOKEN` at build time. `src/analytics.ts` loads the CF beacon **only** when set; reports **pathname-only** URLs (strips `?q=`). |
| **Do not** | Add Google Analytics that captures query strings with tickers. Do not invent a CF token. |

---

## Favicon / social

| Asset | Status |
|-------|--------|
| `/favicon.png` (+ apple-touch / sizes) | Market Check magnifying-glass + candlestick mark |
| `/og-share.png` (1200×630) | Market Check logo lockup on black — not Cloudflare default |
| Cache-bust | `?v=6` on favicon / og references |

---

## Publisher contact

```ts
// src/publisher.ts
export const PUBLISHER_EMAIL = ''; // set to a real inbox when ready; never example.com
```

Update `public/contact/index.html` to match when setting a real email.

---

## Build & deploy

```bash
cd /workspace/market-check
npm run build
npx wrangler pages deploy dist --project-name=market-check
```

Or: `npm run deploy`.

Confirm after deploy:

```bash
curl -s https://marketcheck.money/privacy/ | grep -o 'marketcheck.money' | head
curl -sI https://marketcheck.money/ads.txt   # expect 404
```

---

## Env cheat-sheet (build-time Vite)

| Variable | Purpose | Default |
|----------|---------|---------|
| `VITE_ADSENSE_CLIENT` | Live AdSense | unset → reserved placeholders |
| `VITE_ADSENSE_SLOT` | Ad unit id | optional |
| `VITE_CF_WEB_ANALYTICS_TOKEN` | CF beacon | unset → use dashboard analytics |
| `VITE_REFRESH_MS` | Quote refresh | `45000` |

Publisher email is **not** an env var — edit `src/publisher.ts`.
