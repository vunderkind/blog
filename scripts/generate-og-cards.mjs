#!/usr/bin/env node
/**
 * Generate per-post OG social cards as 1200x630 PNGs in et-book serif
 * + cream Tufte palette. One PNG per published post, written to:
 *   theme/assets/og/<slug>.png
 *
 * Default.hbs references these via /assets/og/<slug>.png.
 *
 * Workflow:
 *  1. Spin up a tiny local HTTP server in scripts/og-render/ so the
 *     template HTML can load et-book woff2 via relative URLs.
 *  2. Pull all published posts via Ghost Admin API.
 *  3. For each post, navigate Playwright to the template URL with
 *     hash-encoded title/subtitle, screenshot at 1200x630.
 *  4. Save PNG, move on.
 *  5. Stop server.
 *
 * Reuses the Playwright install in .verify/<latest>/node_modules.
 *
 * Usage:
 *   node scripts/generate-og-cards.mjs            # all published
 *   node scripts/generate-og-cards.mjs <slug>     # one specific post
 */

import crypto from 'node:crypto';
import { readFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OG_OUT = path.join(ROOT, 'theme/assets/og');
const TEMPLATE_DIR = path.join(ROOT, 'scripts/og-render');

// --- env ---
function loadEnv() {
  try {
    const txt = readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
loadEnv();

const KEY = process.env.GHOST_ADMIN_API_KEY;
const HOST = (process.env.GHOST_ADMIN_API_URL || 'https://gist.holeyfox.co').replace(/\/$/, '');
if (!KEY || !KEY.includes(':')) {
  console.error('error: GHOST_ADMIN_API_KEY missing/malformed in .env');
  process.exit(1);
}
const [keyId, keySecret] = KEY.split(':');

function makeJwt() {
  const header = { alg: 'HS256', kid: keyId, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + 5 * 60, aud: '/admin/' };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${b64(header)}.${b64(payload)}`;
  const sig = crypto
    .createHmac('sha256', Buffer.from(keySecret, 'hex'))
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

async function api(method, urlPath) {
  const url = `${HOST}/ghost/api/admin${urlPath}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Ghost ${makeJwt()}`,
      'Accept-Version': 'v6.0',
    },
  });
  if (!res.ok) throw new Error(`${method} ${urlPath} → ${res.status}`);
  return res.json();
}

// --- Tiny static server for og-render/ ---
function startServer(dir) {
  return new Promise((resolve) => {
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.ttf': 'font/ttf',
      '.css': 'text/css',
      '.js': 'text/javascript',
    };
    const server = http.createServer((req, res) => {
      let p = req.url.split('?')[0].split('#')[0];
      if (p === '/' || p === '') p = '/index.html';
      const file = path.join(dir, p);
      try {
        const data = readFileSync(file);
        const ext = path.extname(file);
        res.writeHead(200, {
          'Content-Type': mime[ext] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(data);
      } catch {
        res.writeHead(404); res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

// --- Locate Playwright in .verify/<latest>/ ---
function findPlaywright() {
  const verifyRoot = path.join(ROOT, '.verify');
  if (!existsSync(verifyRoot)) return null;
  const dirs = readdirSync(verifyRoot).sort().reverse();
  for (const d of dirs) {
    const p = path.join(verifyRoot, d, 'node_modules/playwright/index.mjs');
    if (existsSync(p)) return p;
  }
  return null;
}

// --- main ---
async function main() {
  const onlySlug = process.argv[2];
  mkdirSync(OG_OUT, { recursive: true });

  const pwPath = findPlaywright();
  if (!pwPath) {
    console.error('error: Playwright not found under .verify/. Install via .verify/<ts>/.');
    console.error('hint: any prior verify-frontend run dropped node_modules there.');
    process.exit(1);
  }
  const { chromium } = await import(pwPath);

  // Fetch published posts
  console.log('# fetching posts...');
  const posts = [];
  let page = 1;
  while (true) {
    const r = await api(
      'GET',
      `/posts/?limit=100&page=${page}&filter=${encodeURIComponent('status:[published,sent]')}&fields=id,slug,title,custom_excerpt,published_at`
    );
    posts.push(...(r.posts || []));
    if ((r.posts || []).length < 100) break;
    page++;
  }
  const targets = onlySlug ? posts.filter((p) => p.slug === onlySlug) : posts;
  console.log(`# ${targets.length} target post(s)`);

  // Spin up local server
  const { server, port } = await startServer(TEMPLATE_DIR);
  const baseUrl = `http://127.0.0.1:${port}/`;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  const page2 = await ctx.newPage();

  async function renderCard({ title, subtitle, date, brand, outPath, label }) {
    const params = new URLSearchParams({
      title: title || '',
      subtitle: subtitle || '',
      date: date || '',
      brand: brand || '~/Life of Mogwai',
    }).toString();
    // Cache buster in query string: hash-only changes don't trigger a
    // page reload in Playwright/Chromium, so the inline script that
    // reads location.hash wouldn't re-run between iterations and every
    // card came out with the previous iteration's content.
    const url = baseUrl + '?n=' + encodeURIComponent(label) + '#' + params;
    try {
      await page2.goto(url, { waitUntil: 'networkidle' });
      await page2.evaluate(() => document.fonts.ready);
      await page2.waitForTimeout(80);
      await page2.screenshot({ path: outPath, fullPage: false, omitBackground: false });
      process.stdout.write('.');
      return true;
    } catch (e) {
      console.error(`\n  ✗ ${label}: ${e.message}`);
      return false;
    }
  }

  let ok = 0, fail = 0;
  for (const p of targets) {
    if (!p.slug) continue;
    const date = p.published_at
      ? new Date(p.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      : '';
    const success = await renderCard({
      title: p.title,
      subtitle: p.custom_excerpt,
      date,
      outPath: path.join(OG_OUT, `${p.slug}.png`),
      label: p.slug,
    });
    if (success) ok++; else fail++;
  }

  // Skip home + author cards when targeting a single slug; the slug
  // flag is for one-off post regeneration.
  if (!onlySlug) {
    // Site-wide fallback card — used on home, tag, paged, and any
    // context that isn't a specific post/page/author.
    const homeOk = await renderCard({
      title: 'Life of Mogwai.',
      outPath: path.join(OG_OUT, 'home.png'),
      label: 'home',
    });
    if (homeOk) ok++; else fail++;

    // Per-author cards. Author pages reference /assets/og/author-<slug>.png
    // from default.hbs.
    console.log('\n# fetching authors...');
    const usersResp = await api('GET', '/users/?limit=100&fields=id,slug,name');
    const authors = usersResp.users || [];
    console.log(`# ${authors.length} author(s)`);
    for (const a of authors) {
      if (!a.slug) continue;
      const success = await renderCard({
        title: a.name || a.slug,
        outPath: path.join(OG_OUT, `author-${a.slug}.png`),
        label: `author-${a.slug}`,
      });
      if (success) ok++; else fail++;
    }
  }

  console.log(`\n# done: ${ok} ok, ${fail} failed → ${OG_OUT}`);

  await ctx.close();
  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error('fatal:', e.message);
  process.exit(1);
});
