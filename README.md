# Market Check

Live public market dashboard: crypto, US stocks, ETFs, indexes, bubble map, trending tokens, and RSS headlines.

- **Live site:** [marketcheck.money](https://marketcheck.money) (the official site)
- **Hosting:** Cloudflare Pages, project `market-check`
- **Support:** support@marketcheck.money

House rules for contributors and agents are in [AGENTS.md](./AGENTS.md).

## Layout

| Path | What it is |
|------|------------|
| `src/` | Vite + TypeScript client (vanilla, no framework) |
| `public/` | Static assets and legal pages (`/privacy/`, `/terms/`, `/contact/`, `/about/`, `/sources/`) |
| `functions/` | Cloudflare Pages Functions, served at `/api/*` |
| `dist/` | Build output from `npm run build`. Not committed |
| `wrangler.toml` | Pages config and the `LAYOUTS` KV binding |

## Local development

```bash
npm ci
npm run dev        # Vite dev server
npm run build      # typecheck + production bundle -> dist/
npm run pages:dev  # serve dist/ with Pages Functions via wrangler
```

Copy `.env.example` to `.env` for optional build-time settings. `.env` is gitignored.

## Deploy

Deploys are run from the owner's machine:

```bash
npm ci && npm run build && npx wrangler pages deploy dist --project-name=market-check
```

See [DEPLOY.md](./DEPLOY.md) for more detail.

## Configuration and secrets

- `wrangler.toml` binds the KV namespace `LAYOUTS` (layouts and sessions).
- Secrets (OAuth client secrets, `SESSION_SECRET`, `RESEND_API_KEY`, and so on) are set as Cloudflare Pages secrets in the dashboard or with `wrangler`. They never go in the repo. `.env.example` lists the names without values.

## `/api/markets` chunking

Cloudflare Workers limit subrequests per invocation, so quote requests are split into chunks:

- **Client:** requests chunks of **15** symbols (`MARKETS_CHUNK` in `src/api/yahoo.ts`).
- **Server:** `functions/api/markets.ts` caps each request at **20** symbols.

> Note: as imported, `src/api/yahoo.ts` sets `MARKETS_CHUNK = 20`. The server cap (20) matches. The client value was left unchanged in the import; bringing it to 15 is a separate change.

## Disclaimer

Not financial advice. Market data may be delayed or unavailable.
