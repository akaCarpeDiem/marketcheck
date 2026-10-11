# Market Check — homepage modules & data sources

Product: **Market Check** (marketcheck.money) — live market prices and headlines in one dashboard. A **checker**, not a trading app. Not investment advice.

## Homepage modules (top → bottom)

| # | Module | What the visitor sees | Data source(s) |
|---|--------|----------------------|----------------|
| 1 | **SEO intro** (static HTML above `#app`) | One-line product + disambiguation + nav | Static copy in `index.html` |
| 2 | **News ticker** | Scrolling mixed headlines | Public RSS via `/api/headlines` (several categories mixed client-side) |
| 3 | **Status strip** (header) | Markets live / quotes loading / stale / error + **last updated** + refresh interval | Client refresh state (`lastOkAt` / `lastAttemptAt`); feeds: CoinGecko + Yahoo |
| 4 | **Market hours strip** | NYSE/Nasdaq **OPEN/CLOSED (estimate)** + NY time | Local clock in `America/New_York` + thin holiday list (not an official exchange calendar) |
| 5 | **Search** | Ticker/coin search above the fold; shareable `/?q=SYM` (and `/quote/SYM` → `?q=`) | Catalog `/api/assets`; quote `/api/markets` (Yahoo proxy) |
| 6 | **Focused quote card** | Single-symbol price after search / `?q=` | Yahoo via `/api/markets` |
| 7 | **Watchlist** | Starred symbols; **localStorage only** | Quotes: Yahoo `/api/markets`; persistence: browser `localStorage` |
| 8 | **Hero / key markets** | BTC-USD, gold, silver, WTI, S&P 500, Nasdaq (+ sparklines) | Yahoo `/api/markets` + `/api/chart` (sparklines); BTC chart link may use CoinGecko |
| 9 | **US crypto table** | Top 10/25 crypto (All / L1s) | **CoinGecko** (`/api` client / markets); empty/error: “CoinGecko unavailable” |
| 10 | **US stocks / ETFs table** | Top 10/25 by mkt cap toggle | **Yahoo** `/api/markets` (curated liquid universe) |
| 11 | **World / indexes · ETFs** | DOW, NDX, QQQ, BND, VNQ, SMH, USD, GLTR, CPER, COPX | **Yahoo** `/api/markets` + `/api/chart` |
| 12 | **Trending panels** (pumps / dumps) | Customizable movers columns | `/api/trending` (Binance / CoinGecko momentum per TF — see README) |
| 13 | **Bubble map** | Category + TF movers | `/api/bubbles` — crypto: CoinGecko/Binance; stocks/ETFs: Yahoo |
| 14 | **Recent headlines** | Tabs + cards with **source name** and **time** | Public RSS via `/api/headlines?category=` |
| 15 | **Footer** | Updated time, disclaimer, Sources / About / legal, provider links | Static + client as-of |

Every quote module footer shows **source name** + **as-of** time. Persistent disclaimer: not financial advice / not a brokerage.

## Added in this UX pass (vs already present)

| Item | Status |
|------|--------|
| Global status + last updated in header | **Improved** (was Live/Stale only; as-of was footer-only) |
| Search box above the fold | **Added** (wired to `/api/assets` + Yahoo quote) |
| Shareable `/?q=` and `/quote/:sym` redirect | **Added** |
| Clear section labels (US stocks, crypto, world/indexes) | **Clarified** (data already present) |
| Headlines source + time | **Already present** |
| Watchlist in localStorage | **Added** |
| Last-updated / source on every quote module | **Added** (`module-meta` footers) |
| Empty/error states (e.g. CoinGecko unavailable) | **Improved** |
| Market hours strip (estimate) | **Added** |
| `/sources` methodology page + sitemap/nav | **Added** |
| `/about` product lock honesty | **Already present** (light Sources link added) |
| Symbol static HTML farms | **Not added** (thin dynamic `?q=` / redirect only) |

## Deploy

Cloudflare Pages project: `market-check` · production host: **https://marketcheck.money/**
