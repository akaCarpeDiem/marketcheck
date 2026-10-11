# Change notes (for parent / user)

## 2026-09-21 — Fix blank flash on tab return

### Root cause
While the tab was hidden, throttled `setInterval`s and the `visibilitychange` handler still called `render()` → `app.innerHTML = …`, wiping `#app`. On focus return, Chrome had often discarded the last compositor frame and the main thread then ran a **burst** of full DOM rebuilds (refreshAll + bubbles + trending + headlines + ticker, each `.then(render)`), blocking paint for 1–few seconds → blank screen.

### Fix
- Skip full `#app` paints while `document.hidden` (keep last painted DOM)
- Coalesce async refresh paints via `scheduleRender()` (one rAF write)
- Soft resume on `visibilitychange` / bfcache `pageshow`: resume ticker WAAPI, one batched fetch, single paint
- Headline rotator does not advance while hidden

### Deploy
- `tsc`/build OK; `npm run deploy` to project `market-check` → https://ea361f43.market-check.pages.dev (live https://marketcheck.money/)

---

## 2026-09-19 — Headlines expansion + Birdeye movers (pumps/dumps) + bubble fill

### Headlines (10 categories)
API → UI label:
1. `tradfi` → **Traditional Finance**
2. `crypto` → **Crypto**
3. `politics` → **Finance in Politics**
4. `housing` → **US Housing Market** (renamed; API id unchanged)
5. `web3nfts` → **Web3 IPs & NFTs**
6. `health` → **Health** (BBC/NYT/Guardian/NIH/CNBC/STAT + YT)
7. `longevity` → **Longevity** (ScienceDaily aging, Nature/Guardian/BBC/NIH keyword-filtered, Fight Aging, Lifespan.io)
8. `technology` → **Technology** (BBC/NYT/Guardian/CNBC Tech, MIT TR, Ars, NVIDIA + YT)
9. `ai` → **AI** (OpenAI, DeepMind, HF, The Decoder, TechCrunch AI + filtered tech + YT)
10. `genart` → **Generative Art** (filtered tech/design + Runway/OpenAI YT)

- `GET /api/headlines?category=tradfi|crypto|politics|housing|web3nfts|health|longevity|technology|ai|genart`
- Items carry `mediaType: 'article' | 'video'`; YouTube via free channel Atom feeds (no API key); ~3 videos capped per category.
- UI: horizontal-scroll dense tabs; video cards show ▶ play badge; still **public, non-paywalled feeds only**.
- Dead YouTube feeds dropped at fetch time (YouTube rate-limits bulk probes with intermittent 404s).

### Trending → Top 10 Pumps / Top 10 Dumps (Birdeye-style left column)
- Single response: `{ pumps: [], dumps: [], items: [], supportedTfs, … }` from `GET /api/trending?tf=`
- Shared TF controls; **shipped working Binance TFs:** `1h, 4h, 8h, 12h, 24h, 7d, 30d, 1y` (klines probed OK on data-api.binance.vision).
- Columns: Token (icon + ticker) | Price | Chg % — compact dense rows, green+/red−.
- No “Profitable Traders” column.

### Bubble map (right)
- **Much smaller** compact 16:9 panel (max ~420px tall) — not stretched to pumps+dumps height.
- Packing: denser PAD + **expandToFill** so the hull reaches all four edges (no empty black corners).
- Inside each disk: logo → ticker → % with rim padding; ellipsis only if unavoidable.

### Crypto bubble TFs
- `CRYPTO_TFS` now includes `4h, 8h, 12h` via Binance klines (same as trending).

### Engineering
- `npm run build` succeeds. **Local commit only — do not redeploy.**

---

## 2026-09-19 — Headlines: 5 categories (housing + Web3 IPs/NFTs)

### Categories (API → UI label)
1. `tradfi` → **Traditional Finance**
2. `crypto` → **Crypto** (was “Crypto & Web3”)
3. `politics` → **Finance in Politics** (renamed from `political` / “Political”)
4. `housing` → **Housing** (new)
5. `web3nfts` → **Web3 IPs & NFTs** (new)

### API
- `GET /api/headlines?category=tradfi|crypto|politics|housing|web3nfts`
- Breaking: `political` → `politics` (old id rejected with 400).

### Feeds used (probed 2026-09-19 PT; working feeds only — no Yahoo)
| Category | Feeds |
|----------|--------|
| **tradfi** | BBC Business, CNBC Markets, CNBC World, NYT Business, WSJ Markets, Guardian Business |
| **crypto** | CoinDesk; BBC/NYT/CNBC/Guardian Technology (crypto keyword filter) |
| **politics** | SEC Press, Federal Reserve; NYT Politics/Business, BBC Business, Guardian US News, CoinDesk (finance/crypto legislation keywords) |
| **housing** | NYT Real Estate, Guardian Housing (`money/property`); Guardian Money, BBC Business, CNBC Real Estate (housing/mortgage keywords) |
| **web3nfts** | NFT Now; Cointelegraph NFT (+ major tech feeds with NFT/IP filter) |

Dropped on probe: CNBC Personal Finance (404), WSJ Real Estate (403), CoinDesk `?tag=nft` / `?category=nft` (ignored — same as main feed), Decrypt `/feed/nft` (not actually NFT-filtered).
Note: CoinDesk/major-paper NFT keyword hits are often empty on a given day — NFT Now + Cointelegraph NFT keep `web3nfts` populated.

Carousel/rotation unchanged across categories. Vite middleware validation updated.


### Movers row layout (same pass)
- Trending Tokens panel hugs content — no empty stretch below the 20th row (`.trend-grid` is `flex: 0 0 auto`, not `flex: 1`).
- Bubble map height **matches** trending panel (JS `syncMoversLayout` measures `.trending-section` → sets `.bubble-section` height; SVG viewBox aspect follows the canvas).
- Removed fixed ~1080px / min-height 640–720 bubble canvas; packing radii tightened for the shorter box (still ~50 bubbles).
- Headlines remain full width underneath the matched-height movers row.

### Engineering
- `HeadlineCategory` updated in `functions/_shared/rssHeadlines.ts`, `src/types.ts`, Pages Function, Vite middleware, UI tabs + slight CSS tab tightening.
- `npm run build` must succeed. **Local commit only — do not redeploy.**

---


## 2026-09-19 — Remove traders; add Recent Headlines (RSS)

### Removed: Most Profitable Traders
- Deleted UI, state, fetch, `/api/traders` Pages Function, Vite middleware stub, `src/api/traders.ts`.
- Removed `TraderItem` type and Birdeye/`BIRDEYE_API_KEY` docs from README / `.env.example`.
- No traders section; nothing where traders was.

### Added: Recent Headlines
- **UI:** Category segmented tabs — Traditional Finance | Crypto & Web3 | Political.
- Polished cards (image or gradient+initial fallback, title, 1–2 line blurb, source + relative time).
- Carousel: auto-advance ~7s, pause on hover, prev/next arrows + dots; click card → article (`target=_blank` `rel=noopener`).
- Thin-category note when few stories; never invents articles.
- **Layout:**
  - **Movers row:** Trending Tokens (left, ~340–380px) | Bubble Map (right, `1fr`) — stacks trending above bubbles on ≤900px.
  - **Headlines full width** underneath that row (not beside trending).
  - `#app` widened to `min(1920px, 100%)` with tighter side padding (8px).

### Data: `GET /api/headlines?category=tradfi|crypto|political`
- Server-side public RSS aggregate + ~7 min in-memory cache; stagger fetches; tolerate single-feed failure; dedupe by link; top ~12.
- Vite middleware mirrors the same handler for local `npm run dev`.
- Light regex RSS/Atom parse (no heavy XML libs / API keys).

#### Feeds used (probed 2026-09-19; working only)
| Category | Feeds |
|----------|--------|
| **tradfi** | BBC Business, CNBC, NYT Business, WSJ Markets, Guardian Business |
| **crypto** | CoinDesk, Cointelegraph, Decrypt, The Block |
| **political** | Decrypt Politics, CoinDesk (keyword-filtered), SEC press releases, Federal Reserve press, The Hill Technology (keyword-filtered), NYT Politics (keyword-filtered) |

Dropped / unavailable on probe: Reuters business & politics RSS (connect fail), The Hill finance feed (empty), CoinDesk `/rss/policy/` (404).

Political keyword filter (broad feeds): SEC, CFTC, bill, regulation, ETF, crypto, banking, Fed, sanctions/tariff, etc. — bare House/Senate/Congress omitted to cut false positives.

### Engineering / docs
- README: RSS disclaimer (aggregation ≠ affiliation); traders section removed.
- `npm run build` must succeed. **Local commit only — do not redeploy.**
