#!/usr/bin/env node
/**
 * Lightweight live smoke for marketcheck.money (no browser).
 * Usage: node scripts/smoke-live.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'https://marketcheck.money';

async function check(path, { expectStatus = 200, expectJson, expectIncludes, expectXml } = {}) {
  const url = BASE + path;
  const res = await fetch(url, { redirect: 'manual' });
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  const row = { path, status: res.status, ok: true, notes: [] };
  if (res.status !== expectStatus) {
    row.ok = false;
    row.notes.push(`status ${res.status} != ${expectStatus}`);
  }
  if (expectJson) {
    try {
      const j = JSON.parse(text);
      if (typeof expectJson === 'function') expectJson(j, row);
    } catch (e) {
      row.ok = false;
      row.notes.push('not json: ' + e.message);
    }
  }
  if (expectIncludes) {
    for (const s of expectIncludes) {
      if (!text.includes(s)) {
        row.ok = false;
        row.notes.push('missing: ' + s);
      }
    }
  }
  if (expectXml && !text.trimStart().startsWith('<?xml')) {
    row.ok = false;
    row.notes.push('not xml');
  }
  if (expectXml && /pages\.dev/.test(text)) {
    row.ok = false;
    row.notes.push('sitemap mentions pages.dev');
  }
  return row;
}

const results = [];
results.push(await check('/', { expectIncludes: ['Market Check', 'id="app"', 'Not financial advice', '/assets/app'] }));
{
  const res = await fetch(BASE + '/', { redirect: 'manual' });
  const html = await res.text();
  const row = { path: '/ (no vite source entry)', status: res.status, ok: true, notes: [] };
  if (html.includes('/src/main.ts')) {
    row.ok = false;
    row.notes.push('deployed Vite source index.html (/src/main.ts) — rebuild and deploy dist/');
  }
  results.push(row);
}
for (const [path, word] of [['/markets/', 'Markets'], ['/heatmap/', 'Heat map'], ['/portfolio/', 'Portfolio'], ['/news/', 'Headlines'], ['/podcasts/', 'Podcasts'], ['/sources/', 'Sources']]) {
  results.push(await check(path, { expectStatus: 200, expectIncludes: [word, 'id="app"'] }));
}
results.push(await check('/privacy/', { expectStatus: 200, expectIncludes: ['Privacy'] }));
results.push(await check('/terms/', { expectStatus: 200, expectIncludes: ['Terms'] }));
results.push(await check('/about/', { expectStatus: 200, expectIncludes: ['About'] }));
results.push(await check('/contact/', { expectStatus: 200, expectIncludes: ['Contact'] }));
results.push(await check('/robots.txt', { expectIncludes: ['Sitemap: https://marketcheck.money/sitemap.xml'] }));
results.push(await check('/sitemap.xml', { expectXml: true, expectIncludes: ['https://marketcheck.money/'] }));
results.push(
  await check('/api/assets?q=AAPL', {
    expectJson: (j, row) => {
      if (!j.assets?.some((a) => /AAPL/i.test(a.yahoo || a.label))) {
        row.ok = false;
        row.notes.push('AAPL missing');
      }
    },
  }),
);
results.push(
  await check('/api/assets?q=BTC', {
    expectJson: (j, row) => {
      if (!j.assets?.some((a) => /BTC/i.test(a.yahoo || a.label))) {
        row.ok = false;
        row.notes.push('BTC missing');
      }
    },
  }),
);
results.push(
  await check('/api/markets?symbols=AAPL', {
    expectJson: (j, row) => {
      if (!j.quotes?.[0]?.ok) {
        row.ok = false;
        row.notes.push('AAPL quote not ok');
      }
    },
  }),
);
results.push(
  await check('/api/cryptos', {
    expectJson: (j, row) => {
      // CoinGecko sometimes refuses Cloudflare's shared addresses. The site copes (browsers ask CoinGecko
      // directly), so an empty answer here is worth knowing about but is not a failed deploy.
      if (!j.items?.length) row.notes.push(`no coin list from the server just now (${j.error ?? 'empty'}); browsers fall back to CoinGecko directly`);
      else row.notes.push(`${j.items.length} coins${j.stale ? ', older copy' : ''}`);
    },
  }),
);
results.push(
  await check('/api/equities', {
    expectJson: (j, row) => {
      const ok = (j.items ?? []).filter((e) => e.ok).length;
      if (ok < 100) {
        row.ok = false;
        row.notes.push(`only ${ok} stocks and funds priced`);
      }
    },
  }),
);
for (const topic of ['markets', 'investing', 'personal-finance', 'crypto', 'real-estate', 'technology', 'policy', 'business', 'commodities', 'healthcare']) {
  results.push(
    await check(`/api/headlines?topic=${topic}`, {
      expectJson: (j, row) => {
        const n = j.items?.length ?? 0;
        const bySource = new Map();
        for (const it of j.items ?? []) bySource.set(it.source, (bySource.get(it.source) ?? 0) + 1);
        const most = [...bySource.entries()].sort((x, y) => y[1] - x[1])[0];
        row.notes.push(
          `${n} stories from ${bySource.size} sources${most ? ` (most from one: ${most[0]}, ${most[1]})` : ''}; ` +
            `feeds with stories ${j.feedsUsed?.length ?? 0}, nothing on topic right now ${j.feedsQuiet?.length ?? 0}, ` +
            `could not be read ${j.feedsFailed?.length ?? 0}${j.feedsFailed?.length ? ` (${j.feedsFailed.join(', ')})` : ''}`,
        );
        if (n < 4) row.ok = false;
      },
    }),
  );
}
results.push(
  await check('/api/podcasts', {
    expectJson: (j, row) => {
      row.notes.push(`${j.shows?.length ?? 0} shows${j.failed?.length ? `; not answering: ${j.failed.join(', ')}` : ''}`);
      if ((j.shows?.length ?? 0) < 10) row.ok = false;
    },
  }),
);
results.push(await check('/api/game/board', { expectJson: (j, row) => { if (!j.ok) { row.ok = false; row.notes.push('board not ok'); } } }));
results.push(
  await check('/api/cryptos?universe=eth', {
    expectJson: (j, row) => {
      row.notes.push(
        `${j.items?.length ?? 0} tokens${j.partial ? ' (from the main coin list: CoinGecko refused the full Ethereum list; a browser asks CoinGecko itself)' : ''}${j.stale ? ', older copy' : ''}${j.error ? `; ${j.error}` : ''}`,
      );
    },
  }),
);

try {
  const redir = await fetch('https://market-check.pages.dev/', { redirect: 'manual' });
  results.push({
    path: 'pages.dev→canonical',
    status: redir.status,
    ok: redir.status >= 300 && redir.status < 400 && (redir.headers.get('location') || '').includes('marketcheck.money'),
    notes: [`location=${redir.headers.get('location')}`],
  });
} catch (e) {
  results.push({ path: 'pages.dev→canonical', status: 0, ok: false, notes: [`could not reach market-check.pages.dev: ${e?.cause?.code || e?.message}`] });
}

let failed = 0;
for (const r of results) {
  const mark = r.ok ? 'OK' : 'FAIL';
  if (!r.ok) failed++;
  console.log(`${mark}\t${r.status}\t${r.path}${r.notes?.length ? '\t' + r.notes.join('; ') : ''}`);
}
console.log(failed ? `\n${failed} failing` : '\nall ok');
process.exit(failed ? 1 : 0);
