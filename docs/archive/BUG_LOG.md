# Market Check — Break-and-fix QA bug log

**Date:** 2026-09-27 (PT)  
**Project:** `/workspace/market-check`  
**Deploy:** Cloudflare Pages `market-check` → **https://marketcheck.money/**  
**Preview:** https://58376b5d.market-check.pages.dev (301 → marketcheck.money)

---

## Bugs fixed this pass

| Severity | What was broken | What changed | Notes |
|----------|-----------------|--------------|-------|
| **High** | First quote refresh waited on `await bootstrapAuth()` → `fetch('/api/auth/me')` with **no timeout**. A hung auth endpoint left the status strip on **“Quotes loading…”** indefinitely even though the shell had painted. | Bootstrap now runs `refreshAll()` **before** waiting on auth; auth failures are caught/logged. | `src/main.ts` |
| **High** | Client fetches (markets, cryptos, search, headlines, bubbles, trending, chart, auth/me) had **no AbortSignal timeout**. A stalled upstream could freeze refresh cycles the same way. | Added `src/api/fetchTimeout.ts` (`AbortSignal.timeout` / fallback) and wired it into client API modules (15s default; 8s auth; 10s search). | Failed/aborted fetches still degrade to stale/error UI — page stays interactive. |
| **Medium** | Watchlist could be cleared only one symbol at a time (× on chips). QA required that the list **can be cleared**. | Added `clearWatchlist()` + **Clear** button (`data-watch-clear`) on the watchlist bar when items exist. | Per-symbol × still works; localStorage key unchanged (`mc-watchlist-v1`). |
| **Low** | No automated live smoke covering SEO pages + search APIs + pages.dev redirect. | Added `scripts/smoke-live.mjs` (curl-level). | Optional; not required for runtime. |

---

## Verified OK (no code change needed)

| Check | Result |
|-------|--------|
| Homepage loads with quotes (not blank forever) | **OK** — live DOM shows “Markets live · Updated …”, prices, tables; SEO intro + `#app` present without JS |
| Search finds AAPL | **OK** — `/api/assets?q=AAPL` returns Apple; UI search + Check/Enter wired |
| Search finds BTC | **OK** — `/api/assets?q=BTC` returns BTC-USD |
| Failed API does not freeze page | **OK** after fix — timeouts + try/catch; status goes stale/err; search remains usable |
| Refresh/update time changes after refresh cycle | **OK** — header shows `Updated …` + `↻ 45s`; `lastOkAt` set on successful `refreshAll` |
| Watchlist persists after reload | **OK** — `localStorage` key `mc-watchlist-v1` |
| Watchlist can be cleared | **OK** after fix — Clear all + per-chip × |
| `/privacy/`, `/terms/`, `/about/`, `/contact/` HTTP 200 | **OK** (trailing slash; bare paths 308 → slash) |
| `*.pages.dev` → marketcheck.money | **OK** — `market-check.pages.dev` **301** → `https://marketcheck.money/` |
| `sitemap.xml` real XML, marketcheck.money only | **OK** |
| `robots.txt` Sitemap line | **OK** — `Sitemap: https://marketcheck.money/sitemap.xml` |
| No placeholder email (example.com, etc.) | **OK** — contact says email not published; `PUBLISHER_EMAIL = ''` |
| No pages.dev in user-facing copy (except hosting note) | **OK** — only legal/about meta note about Cloudflare alias |
| No “AI-powered investment” language | **OK** |
| Disclaimer visible on dashboard | **OK** — “Not financial advice…” in `#app` footer |
| Keyboard can use search | **OK** — focusable input; Enter focuses first/typed symbol; Check button |
| Contrast light/dark | **N/A / OK** — dark theme only; muted `#8b96a8` on `#0a0c10` is readable |
| Mobile usable | **OK** by CSS review — wrap/overflow rules at ≤720px; no blocking overlays found |
| No console error loop patterns | **OK** — image `onerror` hides once; bubble rAF token-guarded; no throw loops found |
| Homepage `<title>` includes “Market Check” | **OK** |

---

## Known limitations

| Item | Detail |
|------|--------|
| API **HEAD** requests | Pages Functions export `onRequestGet` only → **HEAD** often **404** while **GET** is **200**. Browsers use GET; not user-facing. |
| CoinGecko rate limits | Crypto table may show stale/fallback rows when upstream 429s; status reflects stale/unavailable. |
| Watchlist is device-local | No account sync for watchlist (by design). |
| Auth/layout routes | Layout PUT/GET still pass raw signals in a few places; guest path does not depend on them for first paint. |
| Light theme | Not implemented — contrast check applies to dark UI only. |
| Uncommitted git tree | Deploy used `--commit-dirty` warning path; working tree has many local changes vs last commit. |

---

## Process notes

1. Smoked live URLs + APIs with curl / `scripts/smoke-live.mjs`.
2. Searched source for placeholder email, pages.dev copy, AI-powered, freeze risks, watchlist clear.
3. Fixed auth-blocking bootstrap + client fetch timeouts + watchlist Clear.
4. `npm run build` + `npx wrangler pages deploy dist --project-name=market-check`.
5. Re-verified live asset hash `index-D9yaykKQ.js` contains `data-watch-clear` and `AbortSignal.timeout`.
