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
for (const [path, word] of [['/markets/', 'Markets'], ['/heatmap/', 'Heat map'], ['/portfolio/', 'Portfolio'], ['/news/', 'Headlines'], ['/sources/', 'Sources']]) {
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
      if (!j.items?.length) {
        row.ok = false;
        row.notes.push('no crypto items');
      }
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
