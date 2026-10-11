# Deploy — Market Check

Preferred: **Cloudflare Pages** (static `dist/` + Pages Functions in `functions/`). Free tier is enough. No paid plans or custom domains required.

## Prerequisites

- Node 20+
- Cloudflare account (free)
- Optional: `gh` authenticated to push to akaCarpeDiem/marketcheck

## A. CLI deploy (fastest once logged in)

```bash
cd /workspace/market-check   # or your clone
npm install
npm run build

# One-time authentication (opens browser / device flow)
npx wrangler login

# First time only — create the Pages project
npx wrangler pages project create market-check

# Deploy static assets; Functions from ./functions are bundled by Pages
npx wrangler pages deploy dist --project-name=market-check
```

Or use the npm script after login:

```bash
npm run deploy
```

Wrangler will print a `*.pages.dev` URL. No env vars needed for production.

### If `wrangler login` is required

Stop here and complete login in the browser, then re-run:

```bash
npx wrangler pages deploy dist --project-name=market-check
```

## B. Git-connected deploy (dashboard)

1. Push this repo to GitHub (`akaCarpeDiem/marketcheck`).
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Select the repo.
4. Build settings:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** `/` (default)
5. Deploy. Pages auto-detects `functions/` as Functions.

## C. Local Pages simulation

```bash
npm run build
npx wrangler pages dev dist
```

This serves `dist` and Pages Functions together (`/api/markets`, `/api/chart`, `/api/trenches`, `/api/bubbles`).

## Vercel (optional)

Cloudflare is preferred. To use Vercel instead you must add a serverless route that mirrors `functions/api/markets.ts` (Yahoo proxy). The included `vercel.json` only documents headers/rewrites — implement `api/markets.ts` before relying on Vercel.

## Pushing to GitHub

```bash
cd /workspace/market-check
git remote add origin https://github.com/akaCarpeDiem/marketcheck.git   # if missing
git push -u origin main
```

If `gh` / git credentials are missing, authenticate first:

```bash
gh auth login
```

Do **not** force-push. Do **not** commit `.env` or secrets.


## Auth secrets (market-check Pages)

Required production secrets / bindings:

| Name | Notes |
|------|--------|
| `LAYOUTS` (KV) | Bound in `wrangler.toml` — magic challenges + hero layouts |
| `SESSION_SECRET` | HMAC session cookie |
| `PUBLIC_ORIGIN` | `https://marketcheck.money` (OAuth redirect URIs: `/api/auth/callback`, `/api/auth/microsoft/callback` on this origin) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | Microsoft OAuth |
| `RESEND_API_KEY` | Magic email — from the Resend dashboard (do not invent) |
| `MAGIC_FROM_EMAIL` | `Market Check <noreply@marketcheck.money>` (domain must be verified in Resend) |

```bash
# Example (pipe value; never commit secrets)
printf '%s' 'Market Check <noreply@marketcheck.money>' | npx wrangler pages secret put MAGIC_FROM_EMAIL --project-name=market-check
# Set remaining secrets in the Cloudflare dashboard
# (Pages → market-check → Settings → Environment variables).
```

## Resend DNS for `marketcheck.money`


Verify the domain in [Resend → Domains](https://resend.com/domains), then add the **exact** records Resend shows (values are account-specific):

| Type | Name | Content (example — use Resend’s values) |
|------|------|-----------------------------------------|
| `TXT` | `resend._domainkey` | DKIM public key from Resend |
| `TXT` | `@` (root) | SPF, typically `v=spf1 include:amazonses.com ~all` (or Resend’s SPF) |
| `TXT` | `_dmarc` | e.g. `v=DMARC1; p=none;` |
| `MX` (if shown) | send / bounce subdomain | As listed in Resend UI |

Add the Resend records in Cloudflare Dashboard → the zone → **DNS** (the deploy-box token can edit DNS on marketcheck.money but cannot manage Email Routing or redirect rules).
