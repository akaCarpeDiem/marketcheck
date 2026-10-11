#!/usr/bin/env node
/**
 * Local development server: the built site plus the real Pages Functions.
 *
 *   node scripts/dev.mjs                 real upstream data (needs internet)
 *   node scripts/dev.mjs --mock          generated data, no network needed
 *   node scripts/dev.mjs --port 5180     another port (default 5173)
 *   node scripts/dev.mjs --no-watch      build once, do not rebuild on change
 *   node scripts/dev.mjs --live          (with --mock) stock prices keep moving when the market is shut
 *
 * It rebuilds when files in src/, content/ or public/ change (reload the page
 * to see it). KV is an in-memory map, so saved layouts last until the server
 * stops. To try the signed-in view without OAuth:
 *
 *   http://127.0.0.1:5173/__dev/login            signs in as a test user
 *   http://127.0.0.1:5173/__dev/logout
 *
 * This is a development tool. `wrangler pages dev dist` remains the closest
 * match to production.
 */
import * as esbuild from 'esbuild';
import http from 'node:http';
import { watch } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from './build.mjs';
import { createMock, iconSvg, photoSvg } from './mock-upstream.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const work = path.join(root, '.wrangler', 'dev-functions');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(option('port', process.env.PORT || 5173));
const useMock = flag('mock');
const origin = `http://127.0.0.1:${port}`;

/* ── Workers runtime stand-ins ───────────────────────────────────────────── */

const kvStore = new Map();
const kv = {
  async get(key, type) {
    const v = kvStore.get(key);
    if (v == null) return null;
    return type === 'json' ? JSON.parse(v) : v;
  },
  async put(key, value) {
    kvStore.set(key, String(value));
  },
  async delete(key) {
    kvStore.delete(key);
  },
};

const edgeStore = new Map();
globalThis.caches = {
  default: {
    async match(req) {
      const hit = edgeStore.get(typeof req === 'string' ? req : req.url);
      return hit ? new Response(hit.body, { headers: hit.headers }) : undefined;
    },
    async put(req, res) {
      edgeStore.set(typeof req === 'string' ? req : req.url, {
        body: await res.text(),
        headers: Object.fromEntries(res.headers),
      });
    },
  },
};

const env = {
  LAYOUTS: kv,
  SESSION_SECRET: 'dev-only-secret-not-used-in-production',
  PUBLIC_ORIGIN: origin,
};

/* ── Functions ───────────────────────────────────────────────────────────── */

async function listFunctionFiles(dir, base = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '_shared') continue;
    const rel = path.posix.join(base, entry.name);
    if (entry.isDirectory()) out.push(...(await listFunctionFiles(path.join(dir, entry.name), rel)));
    else if (entry.name.endsWith('.ts')) out.push(rel);
  }
  return out;
}

let routes = new Map();
let middleware = null;
let shared = {};
let buildId = 0;

async function loadFunctions() {
  buildId += 1;
  const files = await listFunctionFiles(path.join(root, 'functions'));
  const outdir = path.join(work, String(buildId));
  await rm(work, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  const entryPoints = Object.fromEntries(files.map((f) => [f.replace(/\.ts$/, ''), path.join(root, 'functions', f)]));
  for (const name of ['session', 'marketCalendar', 'sectors', 'universes']) {
    entryPoints[`_shared/${name}`] = path.join(root, 'functions', '_shared', `${name}.ts`);
  }
  await esbuild.build({
    entryPoints,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    outdir,
    outExtension: { '.js': '.mjs' },
    logLevel: 'warning',
  });
  const next = new Map();
  let mw = null;
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(outdir, f.replace(/\.ts$/, '.mjs'))).href);
    if (f === '_middleware.ts') {
      mw = mod;
      continue;
    }
    next.set(`/${f.replace(/\.ts$/, '')}`, mod);
  }
  const load = (name) => import(pathToFileURL(path.join(outdir, '_shared', `${name}.mjs`)).href);
  shared = {
    session: await load('session'),
    calendar: await load('marketCalendar'),
    sectors: await load('sectors'),
    universes: await load('universes'),
  };
  routes = next;
  middleware = mw;
}

/* ── Upstream ────────────────────────────────────────────────────────────── */

const realFetch = globalThis.fetch;
let mock = null;

function installMock() {
  const names = {};
  for (const d of [...shared.universes.STOCK_UNIVERSE, ...shared.universes.ETF_UNIVERSE]) names[d.yahoo] = d.name;
  mock = createMock({
    universePrices: { ...shared.sectors.SEED_PRICES },
    shares: shared.sectors.SEED_SHARES,
    names,
    calendar: shared.calendar,
    live: flag('live'),
  });
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith(origin) || url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
      return realFetch(input, init);
    }
    const res = await mock.handle(input);
    if (res) return res;
    throw new TypeError(`mock: no stand-in for ${new URL(url).hostname}`);
  };
}

/**
 * Mock mode only: nine hours of hourly price records, so the 4h and 8h views
 * have something to show without waiting half a day (see cryptoHistory.ts).
 */
async function seedPriceHistory() {
  const res = await mock.handle('https://api.coingecko.com/api/v3/coins/markets?per_page=250');
  const rows = await res.json();
  const HOUR = 3_600_000;
  const now = Date.now();
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const drift = new Map(rows.map((r) => [r.id, /usd|tether/i.test(`${r.id} ${r.name}`) ? 0 : rand() * 0.012 + (rand() > 0.9 ? rand() * 0.03 : 0)]));
  for (let h = 1; h <= 10; h++) {
    const at = Math.floor(now / HOUR) * HOUR - h * HOUR + 5 * 60_000;
    const p = {};
    for (const r of rows) p[r.id] = Number((r.current_price * (1 - drift.get(r.id) * h * (1 + 0.2 * rand()))).toPrecision(7));
    kvStore.set(`snap:crypto:v1:${Math.floor(at / HOUR)}`, JSON.stringify({ at, p }));
  }
}

/* ── HTTP ────────────────────────────────────────────────────────────────── */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

async function staticResponse(pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.includes('..')) return new Response('Bad path', { status: 400 });
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.join(dist, rel);
  try {
    const s = await stat(file);
    if (s.isDirectory()) {
      return new Response(null, { status: 308, headers: { Location: `${pathname}/` } });
    }
  } catch {
    if (!path.extname(rel)) {
      try {
        await stat(path.join(dist, rel, 'index.html'));
        return new Response(null, { status: 308, headers: { Location: `${pathname}/` } });
      } catch {
        /* fall through to 404 */
      }
    }
    if (rel.startsWith('/assets/')) return new Response('Not found', { status: 404 });
    try {
      return new Response(await readFile(path.join(dist, '404.html')), {
        status: 404,
        headers: { 'Content-Type': TYPES['.html'] },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }
  return new Response(await readFile(file), {
    headers: {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    },
  });
}

async function devRoute(url) {
  if (url.pathname === '/__dev/login') {
    const token = await shared.session.signSession(
      {
        sub: 'dev:tester',
        email: url.searchParams.get('email') || 'tester@example.com',
        name: url.searchParams.get('name') || 'Test User',
        exp: Math.floor(Date.now() / 1000) + 86_400,
      },
      env.SESSION_SECRET,
    );
    return new Response(null, {
      status: 302,
      headers: {
        Location: url.searchParams.get('to') || '/',
        'Set-Cookie': `${shared.session.SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
      },
    });
  }
  if (url.pathname === '/__dev/logout') {
    return new Response(null, {
      status: 302,
      headers: { Location: '/', 'Set-Cookie': `${shared.session.SESSION_COOKIE}=; Path=/; Max-Age=0` },
    });
  }
  if (url.pathname === '/__dev/icon') {
    return new Response(iconSvg(url.searchParams.get('s') || '?'), {
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' },
    });
  }
  if (url.pathname === '/__dev/img') {
    return new Response(photoSvg(Number(url.searchParams.get('i')) || 0), {
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' },
    });
  }
  if (url.pathname === '/__dev/kv') {
    return new Response(JSON.stringify(Object.fromEntries(kvStore), null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

async function handle(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/__dev/')) {
    const res = await devRoute(url);
    if (res) return res;
  }
  const pending = [];
  const context = {
    request,
    env,
    params: {},
    waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => undefined)),
    next: async () => {
      const key = url.pathname.replace(/\/$/, '');
      const mod = routes.get(key);
      if (mod) {
        if (useMock && key === '/api/headlines') {
          return new Response(JSON.stringify(mock.headlines(url.searchParams.get('category') || 'tradfi')), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const method = request.method[0] + request.method.slice(1).toLowerCase();
        const fn = mod[`onRequest${method}`] ?? mod.onRequest;
        if (!fn) return new Response('Method not allowed', { status: 405 });
        return fn(context);
      }
      if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
      return staticResponse(url.pathname);
    },
  };
  const res = middleware?.onRequest ? await middleware.onRequest(context) : await context.next();
  await Promise.all(pending);
  return res;
}

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const request = new Request(`${origin}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: hasBody ? Buffer.concat(chunks) : undefined,
    });
    const response = await handle(request);
    const headers = {};
    response.headers.forEach((v, k) => {
      if (k !== 'set-cookie') headers[k] = v;
    });
    const cookies = response.headers.getSetCookie?.() ?? [];
    // The real cookie is Secure; plain http on 127.0.0.1 needs it without.
    if (cookies.length) headers['set-cookie'] = cookies.map((c) => c.replace(/;\s*Secure/gi, ''));
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(String(e?.stack || e));
  }
});

async function rebuild(what) {
  try {
    if (what !== 'functions') await build({ dev: true });
    if (what !== 'site') {
      await loadFunctions();
      if (useMock) {
        installMock();
        if (![...kvStore.keys()].some((k) => k.startsWith('snap:crypto:'))) await seedPriceHistory();
      }
    }
  } catch (e) {
    console.error('build failed:', e?.message || e);
  }
}

await rebuild('all');
server.listen(port, '127.0.0.1', () => {
  console.log(`Market Check dev server: ${origin}  ${useMock ? '(mock data)' : '(live upstream data)'}`);
});

if (!flag('no-watch')) {
  let timer = null;
  const queue = new Set();
  const trigger = (what) => {
    queue.add(what);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const both = queue.has('site') && queue.has('functions');
      const what2 = both ? 'all' : [...queue][0];
      queue.clear();
      await rebuild(what2);
    }, 150);
  };
  for (const dir of ['src', 'content', 'public']) {
    try {
      watch(path.join(root, dir), { recursive: true }, () => trigger('site'));
    } catch {
      /* directory may not exist yet */
    }
  }
  watch(path.join(root, 'functions'), { recursive: true }, () => trigger('all'));
}
