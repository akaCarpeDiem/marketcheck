# How the front end is put together

The browser app is plain TypeScript with no framework and no runtime dependencies. `scripts/build.mjs` bundles it with esbuild into one script and one stylesheet, and writes an HTML file for every page.

## Folders in `src/`

| Folder | What lives there |
|--------|------------------|
| `site/` | `pages.ts`: the list of pages and the HTML document around each one (titles, descriptions, tags for Google Analytics and AdSense). `shell.ts`: the top bar, tab bar and footer. Both run at build time; `shell.ts` also runs in the browser |
| `lib/` | Small tools with no knowledge of the site: `dom` (templates and rendering), `store` (signals), `format` (numbers, dates), `api`, `poll`, `icons`, `spark` (small charts), `pack` (bubble layout), `treemap` |
| `data/` | What the app knows: `market` (prices), `user` (account, watchlist, portfolio, layout), `assets` (one way to describe any coin, stock or fund), `movers`, `news`, `calendar`, `portfolio`, `game`, `visit`, `theme` |
| `ui/` | Parts used by more than one page: the asset sheet (`drawer`), search, sign-in, charts, the bubble map and heat map canvases, toasts, ad slots |
| `views/` | One file per page, and `views/parts/` for the sections of the overview |
| `styles/` | `tokens.css` (colours, sizes, both themes), `base.css`, `shell.css`, `ui.css`, `views.css` |

Code in `src/` imports shared rules straight from `functions/_shared/` (the market calendar, the lists of stocks and funds, the shape of saved data), so the browser and the server cannot disagree about them.

## How a page gets drawn

1. The HTML file for the page already contains the frame and a short introduction, so there is something to read before any script runs.
2. `main.ts` starts the frame (`ui/shell.ts`), starts loading prices (`data/market.ts`), asks the server who the visitor is (`data/user.ts`, one request to `/api/bootstrap`), and starts the router.
3. The router mounts the view for the address. Moving between the five app pages swaps the view without reloading. Text pages are ordinary page loads.
4. A view subscribes to the signals it needs and repaints when one changes. Views build HTML strings with the `html` template tag, which escapes every value, and hand them to `render()`, which only touches the page when the HTML actually changed. Clicks are handled by one listener per view (`on(el, 'click', selector, handler)`).

A view is an object with `mount(el)` that returns a clean-up function. Use a `Scope` to collect subscriptions so they are all removed when the view goes away.

### Adding a page

1. Add it to `APP_PAGES` in `src/site/pages.ts` (address, title, description, introduction).
2. Add it to `NAV` in `src/site/shell.ts` and to `ROUTES` and `TITLES` in `src/router.ts`.
3. Write `src/views/<name>.ts` and register it in `src/main.ts`.

For a text page, add `content/<name>.html` and an entry in `STATIC_META` in `src/site/pages.ts`.

## Where prices come from

`data/market.ts` holds five signals:

| Signal | Endpoint | Holds |
|--------|----------|-------|
| `crypto` | `/api/cryptos` | The 250 largest coins with 1h, 24h, 7d, 30d and 1y changes |
| `equities` | `/api/equities` | Every stock and fund in the tables with 1D, 1W, 1M, YTD and 1Y changes |
| `quotes` | `/api/markets` | Anything else on screen: indexes, commodities, a visitor's own symbols |
| `sparks` | `/api/sparklines` | Small chart series |
| `mood` | `/api/mood` | Crypto Fear & Greed |

Tables, movers, bubbles and the heat map are all worked out in the browser from `crypto` and `equities`, so changing a timeframe or a category never waits for the network. A view says which extra symbols it needs with `wantQuotes(owner, symbols)` and takes them back with `wantQuotes(owner, [])` when it leaves.

Refresh times follow the market: faster while New York is open, slower when it is shut. They are set at the bottom of `data/market.ts`.

`data/assets.ts` turns a coin, a stock, a saved tile or a search result into one `AssetRef`, and `lookup(ref)` returns its current price from whichever signal has it. Use these instead of reading the signals directly.

## What a visitor saves

- **Watchlist, portfolio, daily call record:** `data/user.ts`. In the browser for guests (`mc-data-v2`), and in KV under `data:<account>` for signed-in visitors, with a copy in the browser for fast loading. Saves are batched, and two devices changing the list at once are merged.
- **Tiles, index tiles, movers panels:** signed-in only, through `/api/layout/*`.
- **Display choices** (theme, which table tab is open): browser only, never sent.

## News and podcasts

`data/news.ts` loads headlines per topic and the podcast directory. Topics, content types and shows are defined once, in `functions/_shared/newsTopics.ts`, and imported by both sides. Every item carries a topic and a type (article, video or podcast), and the news page filters by either. Podcasts are a page of their own (`views/podcasts.ts`), not a topic.

## Daily call

`data/game.ts` places calls and reads results; the rules are in `functions/_shared/game.ts`, shared with the server. For signed-in players the server's copy of the game wins after every save, because it decides which calls count for the leaderboard (`ui/board.ts`, `data/board.ts`).

## Bubble maps

`lib/pack.ts` places circles so they fill a rectangle of any shape. It grows every circle from a small start, pushes overlapping ones apart, shakes the layout loose when it jams, and repeats from several starting arrangements for up to 70 ms, keeping the fullest. The maths is separate from drawing (`ui/bubbles.ts`) so it can be tested: `scripts/test/pack.test.mjs` fails if circles overlap, leave the box, or fill less of it than expected.

The number of bubbles follows the size of the box, so a phone shows fewer, larger bubbles instead of a crowd of dots. A layout is recomputed only when the set of bubbles or their sizes change; a price tick alone repaints the labels.

## Themes

Colours are CSS variables in `styles/tokens.css`, defined once for dark (the default) and once for light. Component styles use these variables instead of naming colours. The choice is stored as `mc-theme` and applied by a one-line script in the page head, before the first paint.

## Advertising

`ui/ads.ts` draws a labelled slot only where a view asks for one, always below the first screen. A slot takes no room until AdSense fills it, so an unfilled slot never leaves a hole in the page.
