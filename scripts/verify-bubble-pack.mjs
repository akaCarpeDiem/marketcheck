/**
 * Sanity check: layout 50 stock-like bubbles on two aspect ratios.
 * Run: node scripts/verify-bubble-pack.mjs
 *
 * Pass criteria (Birdeye fill, no corner pins):
 *  - overlaps === 0
 *  - fillX >= 0.90 and fillY >= 0.90
 *  - minPairwiseGap >= PAD (~5)
 *  - no requirement that a bubble sits in each corner
 *
 * Also writes scripts/bubble-preview.{svg,html,png}.
 */
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

async function loadLayout() {
  const esbuild = await import('esbuild');
  const outfile = path.join(root, 'scripts', '.bubbleMap.verify.mjs');
  await esbuild.build({
    entryPoints: [path.join(root, 'src/components/bubbleMap.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    plugins: [
      {
        name: 'stub-format',
        setup(build) {
          build.onResolve({ filter: /^\.\.\/format$/ }, () => ({
            path: 'format-stub',
            namespace: 'stub',
          }));
          build.onResolve({ filter: /^\.\.\/types$/ }, () => ({
            path: 'types-stub',
            namespace: 'stub',
          }));
          build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
            if (args.path === 'format-stub') {
              return {
                contents: `
                  export const formatMktCap = (n) => String(n);
                  export const formatMoney = (n) => String(n);
                  export const formatPct = (n) => String(n);
                `,
                loader: 'js',
              };
            }
            return { contents: `export {};`, loader: 'js' };
          });
        },
      },
    ],
  });
  return import(pathToFileURL(outfile).href + '?t=' + Date.now());
}

function fakeItems(n = 50) {
  const syms = [
    'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','NFLX','AMD','BAC',
    'JPM','XOM','CVX','UNH','JNJ','V','MA','WMT','PG','HD',
    'COST','AVGO','ORCL','CRM','ADBE','PEP','INTC','QCOM','TXN','IBM',
    'GS','MS','C','WFC','T','VZ','DIS','CMCSA','NKE','MCD',
    'SBUX','BA','CAT','GE','MMM','HON','UPS','FDX','PYPL','SQ',
  ];
  return Array.from({ length: n }, (_, i) => {
    const symbol = syms[i % syms.length] + (i >= syms.length ? String(i) : '');
    const pct = ((i * 17) % 200) / 10 - 8;
    const vol = 1e6 * (1 + ((i * 31) % 100));
    return {
      id: `s-${i}`,
      symbol,
      name: symbol + ' Inc',
      image: null,
      price: 100 + i,
      changePercent: pct,
      volume: vol,
      marketCap: vol * 50,
      ok: true,
    };
  });
}

/** True if some small bubble is forced into a geometric corner (legacy failure). */
function cornerOrphans(nodes, width, height, margin = 4) {
  const corners = [
    { x: margin, y: margin },
    { x: width - margin, y: margin },
    { x: margin, y: height - margin },
    { x: width - margin, y: height - margin },
  ];
  let pinned = 0;
  for (const c of corners) {
    for (const n of nodes) {
      const dist = Math.hypot(n.x - (c.x < width / 2 ? n.r + margin : width - n.r - margin),
                              n.y - (c.y < height / 2 ? n.r + margin : height - n.r - margin));
      // Exact corner pin: center at (MARGIN+r, MARGIN+r) etc.
      const idealX = c.x < width / 2 ? margin + n.r : width - margin - n.r;
      const idealY = c.y < height / 2 ? margin + n.r : height - margin - n.r;
      if (Math.hypot(n.x - idealX, n.y - idealY) < 1.5) {
        pinned++;
        break;
      }
    }
  }
  return pinned;
}

const mod = await loadLayout();
const { layoutBubbles, measureFill, countHardOverlaps, minPairwiseGap, renderBubbleSvg } = mod;

const cases = [
  { width: 900, height: 420 },
  { width: 700, height: 500 },
];

const items = fakeItems(50);
let allOk = true;

for (const { width, height } of cases) {
  const nodes = layoutBubbles(items, width, height);
  const m = measureFill(nodes, width, height);
  const overlaps = countHardOverlaps(nodes);
  const minGap = minPairwiseGap(nodes);
  const corners = cornerOrphans(nodes, width, height);

  const radii = nodes.map((n) => n.r).sort((a, b) => a - b);
  const area = nodes.reduce((s, n) => s + Math.PI * n.r * n.r, 0);
  const areaFrac = area / (width * height);

  // No corner-pin requirement — only contiguous fill metrics.
  const ok =
    overlaps === 0 &&
    m.fillX >= 0.9 &&
    m.fillY >= 0.9 &&
    minGap >= 5 - 1e-3;
  if (!ok) allOk = false;

  console.log(JSON.stringify({
    size: `${width}x${height}`,
    n: nodes.length,
    overlaps,
    fillX: +m.fillX.toFixed(4),
    fillY: +m.fillY.toFixed(4),
    minPairwiseGap: +minGap.toFixed(4),
    areaFrac: +areaFrac.toFixed(4),
    minR: +radii[0].toFixed(2),
    maxR: +radii[radii.length - 1].toFixed(2),
    medianR: +radii[Math.floor(radii.length / 2)].toFixed(2),
    exactCornerPins: corners,
    ok,
  }, null, 2));
}

// Preview at the wide aspect (matches Market Check panel).
{
  const width = 900;
  const height = 420;
  const svg = renderBubbleSvg(items, { width, height, tfLabel: '24h' });
  const svgPath = path.join(__dirname, 'bubble-preview.svg');
  const htmlPath = path.join(__dirname, 'bubble-preview.html');
  const pngPath = path.join(__dirname, 'bubble-preview.png');
  fs.writeFileSync(svgPath, svg);
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0a0a0a;width:${width}px;height:${height}px;overflow:hidden">${svg}</body></html>`;
  fs.writeFileSync(htmlPath, html);

  const chrome = process.env.CHROME_PATH || 'google-chrome';
  const shot = spawnSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--window-size=${width},${height}`,
    `--screenshot=${pngPath}`,
    `file://${htmlPath}`,
  ], { encoding: 'utf8' });
  if (shot.status !== 0) {
    console.error('screenshot failed', shot.stderr || shot.stdout);
    allOk = false;
  } else {
    console.log(JSON.stringify({ preview: pngPath, bytes: fs.statSync(pngPath).size }));
  }
}

if (!allOk) process.exitCode = 1;
