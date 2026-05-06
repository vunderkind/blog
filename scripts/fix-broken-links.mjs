#!/usr/bin/env node
/**
 * Find dead external links/images across all Ghost posts and replace them
 * with wayback-machine snapshots where available, or unwrap the <a> tag
 * (keep text, drop link) when no snapshot exists.
 *
 * Usage:
 *   node scripts/fix-broken-links.mjs            # dry run — prints proposed edits
 *   node scripts/fix-broken-links.mjs --apply    # actually PUTs to the Admin API
 *
 * Reads GHOST_ADMIN_API_KEY (id:secret) from .env.
 *
 * Strategy:
 *   - Pre-curated list of known-dead URL stems (DNS-gone, real 404s, SSL
 *     mismatches). Bot-blocked sites (opensea, twitter, medium, etc.) are
 *     intentionally excluded — they work for human readers.
 *   - For each post, fetch html source via the Admin API.
 *   - Find each broken stem. If wayback has a snapshot, swap the href/src
 *     to the wayback URL. Otherwise unwrap the <a> tag, preserving text.
 *     For dead <img>, keep the figure element but null the src and add a
 *     visible "[image lost]" caption.
 *   - PUT the cleaned post back via ?source=html.
 */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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
  console.error('error: GHOST_ADMIN_API_KEY missing or malformed in .env');
  process.exit(1);
}
const [keyId, keySecret] = KEY.split(':');
const APPLY = process.argv.includes('--apply');

// --- JWT ---
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

async function api(method, urlPath, body) {
  const url = `${HOST}/ghost/api/admin${urlPath}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Ghost ${makeJwt()}`,
      'Accept-Version': 'v6.0',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${method} ${urlPath} → ${res.status}\n${txt.slice(0, 800)}`);
  return txt ? JSON.parse(txt) : null;
}

// --- Wayback helper ---
async function wayback(url) {
  try {
    const r = await fetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
      { headers: { 'User-Agent': 'mogwai-link-fixer' } }
    );
    if (!r.ok) return null;
    const j = await r.json();
    const snap = j?.archived_snapshots?.closest;
    if (snap && snap.available && snap.status === '200') {
      // Force https if wayback returns http
      return snap.url.replace(/^http:\/\//, 'https://');
    }
  } catch {}
  return null;
}

// --- Known-dead URL stems (no `?ref=` query). DNS-gone, 404, SSL-bust. ---
// Bot-blocked sites (opensea, twitter, medium, claude.ai, npm, etc.) are
// intentionally NOT here — they work for humans.
const DEAD_STEMS = [
  'https://blog.coinbase.com/a-simple-guide-to-the-web3-stack-785240e557f0',
  'https://bloomtech.com/',
  'https://bundlr.network/',
  'https://chidiwilliams.com/',
  'https://cryptozombies.com/',
  'https://docs.provable.xyz/',
  'https://dspy.ai/',
  'https://learn.figment.io/',
  'https://lootproject.substack.com/p/nftchainrule',
  'https://mastodon.holeyfox.co/',
  'https://newsletter.banklesshq.com/p/how-to-value-defi-tokens',
  'https://newsletter.banklesshq.com/p/the-first-profitable-blockchain',
  'https://solana.com/',
  'https://www.enaira.gov.ng/',
  'https://www.readup.com/',
  'https://readup.com/',
  'https://africanliterarymagazines.singlestory.org/etisalat-announces-top-entries-for-etisalat-prize-for-literature-flash-fiction',
  'https://web.archive.org/web/20220523060533im_/https://blog.justinirabor.com/img/game.png',
];

// Strip a trailing `?ref=...` etc. for comparison only.
function stem(url) {
  return url.split('?')[0].replace(/\/+$/, '');
}

const DEAD_STEM_SET = new Set(DEAD_STEMS.map(stem));

function isDead(url) {
  return DEAD_STEM_SET.has(stem(url));
}

// --- HTML mutation ---
async function fixHtml(html) {
  // Find all <a href="..."> and <img src="..."> with dead targets.
  const edits = [];
  // <a> tags: try to replace href with wayback. If no wayback, unwrap.
  const aRe = /<a\b([^>]*?)\bhref="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi;
  const imgRe = /<img\b([^>]*?)\bsrc="([^"]+)"([^>]*)>/gi;

  // Collect all dead urls present in this html, dedupe, look up wayback for each once.
  const found = new Set();
  for (const m of html.matchAll(aRe)) if (isDead(m[2])) found.add(m[2]);
  for (const m of html.matchAll(imgRe)) if (isDead(m[2])) found.add(m[2]);
  if (!found.size) return { html, edits };

  const wbMap = {};
  for (const u of found) {
    wbMap[u] = await wayback(stem(u));
  }

  // Rewrite anchors
  let out = html.replace(aRe, (whole, pre, href, post, inner) => {
    if (!isDead(href)) return whole;
    const wb = wbMap[href];
    if (wb) {
      edits.push({ type: 'a→wayback', href, wb });
      return `<a${pre}href="${wb}"${post}>${inner}</a>`;
    } else {
      edits.push({ type: 'a-unwrap', href, text: inner.replace(/<[^>]+>/g, '').slice(0, 60) });
      return inner; // strip the link tag, keep inner text/markup
    }
  });

  // Rewrite images
  out = out.replace(imgRe, (whole, pre, src, post) => {
    if (!isDead(src)) return whole;
    const wb = wbMap[src];
    if (wb) {
      edits.push({ type: 'img→wayback', src, wb });
      return `<img${pre}src="${wb}"${post}>`;
    } else {
      edits.push({ type: 'img-removed', src });
      // Keep alt text as figcaption-like fallback
      const alt = (whole.match(/alt="([^"]*)"/i) || [, ''])[1];
      return `<span class="sans" style="opacity:.6">[image lost${alt ? ': ' + alt : ''}]</span>`;
    }
  });

  return { html: out, edits };
}

// --- main ---
async function main() {
  const mode = APPLY ? 'APPLY' : 'DRY-RUN';
  console.log(`# Mode: ${mode}\n# Host: ${HOST}\n`);

  // Paginate through ALL posts (incl. drafts) so we clean up content
  // before republish too.
  const posts = [];
  let page = 1;
  while (true) {
    const r = await api(
      'GET',
      `/posts/?limit=100&page=${page}&formats=html&fields=id,slug,title,updated_at,html,status`
    );
    posts.push(...(r.posts || []));
    if ((r.posts || []).length < 100) break;
    page++;
  }
  console.log(`# Found ${posts.length} posts (all statuses)\n`);

  let totalEdits = 0;
  let postsTouched = 0;
  for (const p of posts) {
    if (!p.html) continue;
    const { html: newHtml, edits } = await fixHtml(p.html);
    if (!edits.length) continue;
    postsTouched++;
    totalEdits += edits.length;
    console.log(`---\n## ${p.slug}  (${p.title})`);
    for (const e of edits) {
      if (e.type === 'a→wayback')   console.log(`   a → wayback   ${e.href}\n                 ${e.wb}`);
      if (e.type === 'a-unwrap')    console.log(`   a UNWRAP      ${e.href}\n                 (keep text: "${e.text}")`);
      if (e.type === 'img→wayback') console.log(`   img → wayback ${e.src}\n                 ${e.wb}`);
      if (e.type === 'img-removed') console.log(`   img REMOVED   ${e.src}`);
    }

    if (APPLY) {
      try {
        await api(
          'PUT',
          `/posts/${p.id}/?source=html`,
          { posts: [{ html: newHtml, updated_at: p.updated_at }] }
        );
        console.log('   ✓ applied');
      } catch (e) {
        console.error(`   ✗ FAILED: ${e.message}`);
      }
    }
  }
  console.log(`\n# ${mode} summary: ${postsTouched} posts, ${totalEdits} edits`);
  if (!APPLY) console.log('# Re-run with --apply to write changes.');
}

main().catch((e) => {
  console.error('fatal:', e.message);
  process.exit(1);
});
