#!/usr/bin/env bash
# Writes CoinGecko's list for one UTC day (default: yesterday) and publishes it on the repo's coin-data
# branch, where functions/api/yesterday.ts reads it. Run shortly after 00:00 UTC every day, from anywhere
# that can push to the repo (CoinGecko often refuses Cloudflare, so not from a Function).
#
#   scripts/coingecko-publish.sh [YYYY-MM-DD]
set -euo pipefail
day="${1:-$(date -u -d 'yesterday' +%F)}"
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
remote="$(git -C "$root" remote get-url origin)"

if git ls-remote --exit-code --heads "$remote" coin-data >/dev/null 2>&1; then
  git clone -q --depth 1 --branch coin-data "$remote" "$work/data"
else
  git init -q "$work/data" && git -C "$work/data" checkout -q --orphan coin-data && git -C "$work/data" remote add origin "$remote"
fi
if [ -f "$work/data/coingecko/$day.json" ] && [ -z "${FORCE:-}" ]; then
  echo "coingecko/$day.json is already published"
  exit 0
fi
mkdir -p "$work/data/coingecko"
node "$root/scripts/coingecko-day.mjs" "$day" "$work/data/coingecko/$day.json"
cd "$work/data"
git add "coingecko/$day.json"
git -c user.name="${GIT_AUTHOR_NAME:-marketcheck-data}" -c user.email="${GIT_AUTHOR_EMAIL:-support@marketcheck.money}" commit -q -m "data: CoinGecko coin list for $day"
git push -q origin HEAD:coin-data
echo "published coingecko/$day.json"
