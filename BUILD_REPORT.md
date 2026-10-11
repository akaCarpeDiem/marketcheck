# Market Check — Build Report

**Date:** 2026-09-19 (PT)  
**Path:** `/workspace/market-check`  
**Build:** `npm run build` — **SUCCESS**

## Sources used

| Data | Source | How |
|------|--------|-----|
| Top 20 crypto | CoinGecko Markets API (`/api/v3/coins/markets`) | Client-side, CORS-friendly |
| BTC, ETH, equities, commodities, indices, DXY, 10Y, VIX | Yahoo Finance chart API (`/v8/finance/chart/{symbol}`) | Proxied via Vite middleware (local) / Cloudflare Pages Function `functions/api/markets.ts` (prod) |
| Crypto fallback list | Hardcoded placeholders in `src/api/coingecko.ts` | Only if CoinGecko fails |

No API keys. Proxy caches ~15–20s. Client refresh default **45s** (`VITE_REFRESH_MS`).

## Live vs fallback tiles (verified 2026-09-19 PT)

| Tile / block | Status |
|--------------|--------|
| Hero: BTC-USD | **Live** (Yahoo) |
| Hero: WTI `CL=F` | **Live** (Yahoo) |
| Hero: Gold `GC=F` | **Live** (Yahoo) |
| Hero: Silver `SI=F` | **Live** (Yahoo) |
| Hero: S&P 500 `^GSPC` | **Live** (Yahoo) |
| Hero: Nasdaq-100 `^NDX` | **Live** (Yahoo) |
| Top 20 crypto | **Live when CoinGecko allows**; this build host hit **HTTP 429** so UI uses **hardcoded fallback** until rate limit clears. End users / Pages typically fine. |
| Indices + mega-caps (Dow, AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA) | **Live** (Yahoo) |
| Extras: ETH-USD | **Live** (Yahoo) |
| Extras: DXY `DX-Y.NYB` | **Live** (Yahoo) |
| Extras: 10Y `^TNX` | **Live** (Yahoo) |
| Extras: VIX `^VIX` | **Live** (Yahoo) |

Broken extras are skipped in the UI (none broken in verification).

## Env vars

| Var | Needed? | Notes |
|-----|---------|-------|
| `VITE_REFRESH_MS` | Optional | Default `45000` |
| Secrets / Yahoo keys | **None** | |

## How to run locally

```bash
cd /workspace/market-check
npm install
npm run dev      # http://localhost:5173 — includes /api/markets proxy
npm run build    # → dist/
```

## Suggested deploy command

```bash
npm run build
npx wrangler login                                          # if not authenticated
npx wrangler pages project create market-check              # first time (live product)
npx wrangler pages deploy dist --project-name=market-check
```

Or: `npm run deploy` after `wrangler login`.

See `DEPLOY.md` for Git-connected Cloudflare Pages and GitHub push steps.

## Deploy status (this session)

- Cloudflare / Wrangler deploy: **not completed** — requires user `wrangler login` (browser/device auth).
- GitHub push to `akaCarpeDiem/marketcheck`: see git notes below.

## Git status

- Local git repo initialized with commits ready.
- Remote: `akaCarpeDiem/marketcheck` (empty upstream expected).
- If `gh` / credentials missing, push is left for the parent/user after auth. No force-push.

## Stack notes

- Vite 6 + TypeScript vanilla
- `wrangler@3.112.0` (Node 20 compatible; wrangler 4 wants Node ≥22)
- Cloudflare Pages: `wrangler.toml` + `functions/api/markets.ts`
- Optional `vercel.json` present; Cloudflare is the supported Functions path

## Session blockers (need user login)

1. **GitHub push** — `git push -u origin main` failed: no credentials (`could not read Username for 'https://github.com'`). Run `gh auth login` then push, or push from a machine with credentials. Repo is ready on `main` at commit `e8f33f1` (plus follow-up if any). Remote: `akaCarpeDiem/marketcheck`.
2. **Cloudflare deploy** — `wrangler pages deploy` failed: non-interactive env needs `CLOUDFLARE_API_TOKEN` or interactive `npx wrangler login`. Exact next command after auth:

```bash
cd /workspace/market-check
npm run build
npx wrangler pages project create market-check   # first time only
npx wrangler pages deploy dist --project-name=market-check
```

## Verification notes

- Local Vite `/api/markets` returned live Yahoo quotes for all hero/mega/extra symbols (2026-09-19 PT).
- CoinGecko returned 429 from this host during build; client falls back to hardcoded top-20 until live data succeeds.
