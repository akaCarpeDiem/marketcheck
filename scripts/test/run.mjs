#!/usr/bin/env node
/**
 * Runs the checks in scripts/test/*.test.mjs. They import TypeScript from the
 * project, so each is bundled with esbuild first (works on any Node 18+).
 *
 *   node scripts/test/run.mjs            all checks
 *   node scripts/test/run.mjs calendar   one check by name
 */
import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const out = path.join(root, '.wrangler', 'test-build');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = (await readdir(here)).filter((f) => f.endsWith('.test.mjs') && (!only.length || only.some((o) => f.startsWith(o))));
if (!files.length) {
  console.error('no matching checks');
  process.exit(1);
}
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
let failed = 0;
for (const f of files) {
  const outfile = path.join(out, f);
  await esbuild.build({
    entryPoints: [path.join(here, f)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'warning',
    // The values scripts/build.mjs injects, so client modules can be imported here.
    define: {
      'import.meta.env.DEV': 'true',
      'import.meta.env.VITE_REFRESH_MS': '""',
      'import.meta.env.VITE_ADSENSE_CLIENT': '""',
      'import.meta.env.VITE_ADSENSE_SLOT': '""',
    },
  });
  const res = spawnSync(process.execPath, [outfile, ...process.argv.slice(2).filter((a) => a.startsWith('--'))], { stdio: 'inherit' });
  if (res.status !== 0) failed += 1;
}
await rm(out, { recursive: true, force: true });
if (failed) {
  console.error(`${failed} of ${files.length} checks failed`);
  process.exit(1);
}
console.log(`${files.length} checks passed`);
