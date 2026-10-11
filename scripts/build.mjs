#!/usr/bin/env node
/**
 * Builds the site into dist/.
 *
 *   node scripts/build.mjs            production build (minified, hashed file names)
 *   node scripts/build.mjs --dev      quick build, no minify (used by scripts/dev.mjs)
 *
 * Steps: bundle src/main.ts and its CSS with esbuild, copy public/, then write
 * one HTML document per page from the page list in src/site/pages.ts and the
 * text in content/*.html.
 *
 * Build-time settings (all optional) come from the environment or a .env file:
 *   VITE_ADSENSE_CLIENT   AdSense publisher id. Defaults to the site's own id.
 *   VITE_ADSENSE_SLOT     Ad unit id for the in-page slots.
 *   VITE_REFRESH_MS       Quote refresh interval override.
 */
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

/** The site's public AdSense publisher id (also in public/ads.txt). */
const DEFAULT_ADSENSE_CLIENT = 'ca-pub-4059575347806121';

async function readDotEnv() {
  const out = {};
  const file = path.join(root, '.env');
  if (!existsSync(file)) return out;
  for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

export async function build({ dev = process.argv.includes('--dev') } = {}) {
  const started = Date.now();
  const fileEnv = await readDotEnv();
  const env = (name, fallback = '') => (process.env[name] ?? fileEnv[name] ?? fallback).trim();
  const settings = {
    VITE_ADSENSE_CLIENT: env('VITE_ADSENSE_CLIENT', DEFAULT_ADSENSE_CLIENT),
    VITE_ADSENSE_SLOT: env('VITE_ADSENSE_SLOT'),
    VITE_REFRESH_MS: env('VITE_REFRESH_MS'),
  };

  await rm(dist, { recursive: true, force: true });
  await mkdir(path.join(dist, 'assets'), { recursive: true });

  // 1. Static files.
  await cp(path.join(root, 'public'), dist, { recursive: true });

  // 2. App bundle (JS + CSS).
  const define = { 'import.meta.env.DEV': JSON.stringify(dev) };
  for (const [k, v] of Object.entries(settings)) define[`import.meta.env.${k}`] = JSON.stringify(v);
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: { app: 'src/main.ts' },
    bundle: true,
    format: 'esm',
    target: 'es2020',
    minify: !dev,
    sourcemap: dev,
    outdir: path.join(dist, 'assets'),
    entryNames: dev ? '[name]' : '[name]-[hash]',
    assetNames: '[name]-[hash]',
    loader: { '.woff2': 'file', '.png': 'file', '.svg': 'file' },
    external: ['/fonts/*', '/img/*'],
    define,
    metafile: true,
    logLevel: 'warning',
    legalComments: 'none',
  });
  let js = '';
  let css = '';
  for (const [file, meta] of Object.entries(result.metafile.outputs)) {
    const name = path.basename(file);
    if (meta.entryPoint === 'src/main.ts') js = name;
    else if (name.endsWith('.css')) css = name;
  }
  if (!js || !css) throw new Error('build: could not find the bundled app files');

  // 3. HTML. The page shell lives in TypeScript so the browser and this script share it.
  const tmp = path.join(dist, '.site.mjs');
  await esbuild.build({
    absWorkingDir: root,
    entryPoints: ['src/site/pages.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: tmp,
    define,
    logLevel: 'warning',
  });
  const site = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`);
  await rm(tmp, { force: true });

  const content = {};
  const contentDir = path.join(root, 'content');
  if (existsSync(contentDir)) {
    for (const f of await readdir(contentDir)) {
      if (f.endsWith('.html')) content[f.replace(/\.html$/, '')] = await readFile(path.join(contentDir, f), 'utf8');
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const pages = site.sitePages({ content });
  for (const page of pages) {
    const html = site.documentHtml(page, {
      js: `/assets/${js}`,
      css: `/assets/${css}`,
      adsenseClient: settings.VITE_ADSENSE_CLIENT,
    });
    const out = path.join(dist, page.file);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, html);
  }

  // 4. sitemap.xml from the same page list.
  const urls = pages
    .filter((p) => p.index !== false)
    .map((p) => `  <url>\n    <loc>https://marketcheck.money${p.path}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`)
    .join('\n');
  await writeFile(
    path.join(dist, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  );

  const size = async (f) => (await readFile(path.join(dist, 'assets', f))).length;
  const hash = createHash('sha1').update(js + css).digest('hex').slice(0, 8);
  console.log(
    `built ${pages.length} pages · ${js} ${(await size(js) / 1024).toFixed(0)} kB · ${css} ${(await size(css) / 1024).toFixed(0)} kB · ${Date.now() - started} ms · ${hash}`,
  );
  return { js, css, pages: pages.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  build().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
