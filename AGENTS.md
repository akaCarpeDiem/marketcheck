# AGENTS.md — house rules

These rules apply to everyone working in this repo, human or agent.

1. **Contact address:** use `support@marketcheck.money` only. Do not add any other contact email anywhere in the site or docs. (`noreply@marketcheck.money` is the transactional sender for sign-in emails, not a contact address.)
2. **Legal pages:** the privacy, terms, and contact pages (`content/privacy.html`, `content/terms.html`, `content/contact.html`) must name **marketcheck.money** as the official site.
3. **`/api/markets` chunking:** the client requests chunks of **15** symbols (`MARKETS_CHUNK` in `src/data/market.ts`), and the server (`functions/api/markets.ts`) caps each request at **20**. Keep both values. They exist because of Cloudflare Workers subrequest limits.
4. **No secrets in the repo:** never commit API tokens, OAuth secrets, session secrets, or `.env` files. Secrets live in Cloudflare Pages settings.
5. **Never revert, patch forward:** do not revert commits or force-push. Fix problems with a new commit.

See [README.md](./README.md) for layout, build, and deploy.
