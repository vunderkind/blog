#!/usr/bin/env node
/**
 * Seed a kitchen-sink Tufte demo post via the Ghost Admin API.
 *
 * Pre-conditions:
 *   1. Ghost is running locally (`docker compose up -d`).
 *   2. You've completed first-run setup (created the owner account at
 *      http://localhost:2368/ghost).
 *   3. You've generated an Admin API key under
 *      Settings → Integrations → Add custom integration.
 *      Copy the "Admin API key" — it looks like "<24-hex>:<64-hex>".
 *   4. Add to .env:
 *        GHOST_ADMIN_API_KEY=<id>:<secret>
 *        GHOST_ADMIN_API_URL=http://localhost:2368   (optional; this is the default)
 *
 * Usage:
 *   node scripts/seed-tufte-demo.mjs
 *
 * Idempotent: if a post with slug "tufte-css-kitchen-sink" already exists,
 * it is deleted first, then recreated.
 */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Tiny .env loader (no dependencies needed)
function loadEnv() {
  try {
    const txt = readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* .env optional */
  }
}
loadEnv();

const KEY = process.env.GHOST_ADMIN_API_KEY;
const HOST = (process.env.GHOST_ADMIN_API_URL || 'http://localhost:2368').replace(/\/$/, '');

if (!KEY || !KEY.includes(':')) {
  console.error('error: GHOST_ADMIN_API_KEY missing or malformed.');
  console.error('  Generate one in Ghost Admin → Settings → Integrations → Add custom integration.');
  console.error('  Then add to .env:  GHOST_ADMIN_API_KEY=<id>:<secret>');
  process.exit(1);
}

const [keyId, keySecret] = KEY.split(':');

// Build a 5-minute JWT (HS256) for the Ghost Admin API
function makeJwt() {
  const header = { alg: 'HS256', kid: keyId, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + 5 * 60, aud: '/admin/' };
  const b64 = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
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
      'Accept-Version': 'v5.0',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status}\n${txt}`);
  }
  return txt ? JSON.parse(txt) : null;
}

const SLUG = 'tufte-css-kitchen-sink';

// The kitchen-sink HTML body — exercises every Tufte CSS feature
const HTML = String.raw`
<p><span class="newthought">This is the kitchen-sink demo.</span> It exists so the verify-frontend skill can confirm that every Tufte CSS feature renders correctly. The narrow column you are reading is 55% of the body width; the white space to the right is reserved for sidenotes and marginnotes. Resize this window below 760px to see the responsive collapse behavior.</p>

<p>Here is a numbered sidenote.<label for="sn-1" class="margin-toggle sidenote-number"></label><input type="checkbox" id="sn-1" class="margin-toggle"/><span class="sidenote">Sidenotes are floated into the right margin and auto-numbered with a CSS counter. They use old-style figures from the et-book-roman-old-style font.</span> Notice the small superscript number, set in old-style figures, and the matching number on the note itself.</p>

<p>Here is a marginnote.<label for="mn-1" class="margin-toggle">&#8853;</label><input type="checkbox" id="mn-1" class="margin-toggle"/><span class="marginnote">Marginnotes are unnumbered. The toggle is hidden on desktop and appears as a ⊕ on narrow viewports.</span> Marginnotes have no number — useful when the margin annotation is supplementary rather than referential.</p>

<p>A second sidenote, to confirm the counter increments.<label for="sn-2" class="margin-toggle sidenote-number"></label><input type="checkbox" id="sn-2" class="margin-toggle"/><span class="sidenote">This should be note 2 — both the superscript marker in the body and the leading number on the note itself.</span> And a third<label for="sn-3" class="margin-toggle sidenote-number"></label><input type="checkbox" id="sn-3" class="margin-toggle"/><span class="sidenote">Note 3, demonstrating that consecutive sidenotes still float correctly.</span> for good measure.</p>

<h2>Section heading (italic, h2)</h2>

<p>This paragraph follows an h2. The heading is italic and 2.2rem. Inline numerals like <span class="numeral">1969</span> use old-style figures with descenders on 3, 4, 5, 7, 9. Inline <span class="sans">sans-serif</span> uses Gill Sans with letter-spacing. <span class="danger">Inline danger text</span> is red.</p>

<h3>Subsection heading (italic, h3)</h3>

<div class="epigraph">
  <blockquote>
    <p>The cowards never started and the weak died on the way; only the strong survived.</p>
    <footer>Anonymous, <cite>The American Frontier</cite></footer>
  </blockquote>
</div>

<p>The epigraph above sets its blockquote in italics and right-aligns the attribution. The cite within the footer is italicized again for typographic balance.</p>

<h2>Figures</h2>

<p>A standard figure occupies the 55% text column:</p>

<figure>
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/EdwardTufte.jpg/640px-EdwardTufte.jpg" alt="Edward Tufte">
  <figcaption>Standard figure with caption (55% column).</figcaption>
</figure>

<p>A full-width figure spans 90%:</p>

<figure class="fullwidth">
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Minard.png/1280px-Minard.png" alt="Minard's chart of Napoleon's march">
  <figcaption>Charles Minard's 1869 chart of Napoleon's Russian campaign — the example Tufte calls the best statistical graphic ever drawn.</figcaption>
</figure>

<h2>Code</h2>

<p>Inline <code>const x = 42;</code> code uses a monospace stack. Block code is set at 0.9rem and 52.5% width:</p>

<pre><code>function fibonacci(n) {
  if (n &lt; 2) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}</code></pre>

<p>A full-width code block:</p>

<pre class="fullwidth"><code>// long line that would otherwise wrap awkwardly in the 52.5% column
const data = [{name:'a',value:1},{name:'b',value:2},{name:'c',value:3},{name:'d',value:4}];
data.forEach(({name, value}) =&gt; console.log(` + "`${name}: ${value}`" + `));</code></pre>

<h2>Tables</h2>

<div class="table-wrapper">
  <table>
    <thead>
      <tr><th>Year</th><th>Event</th><th>Page</th></tr>
    </thead>
    <tbody>
      <tr><td>1969</td><td>Apollo 11</td><td>104</td></tr>
      <tr><td>1977</td><td>Voyager launch</td><td>118</td></tr>
      <tr><td>2012</td><td>Curiosity lands</td><td>167</td></tr>
    </tbody>
  </table>
</div>

<h2>Iframe (16:9 responsive)</h2>

<div class="iframe-wrapper">
  <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" allowfullscreen></iframe>
</div>

<h2>Closing</h2>

<p>If everything above renders correctly — sidenotes in the margin, full-width Minard chart, 16:9 video, old-style numerals, italic h2/h3, dotted-style links — Tufte CSS is wired up correctly.</p>
`;

async function main() {
  console.log(`> Connecting to Ghost at ${HOST}`);

  // 1. Find any existing post with this slug, delete it.
  const found = await api('GET', `/posts/slug/${SLUG}/?formats=html`);
  if (found?.posts?.[0]) {
    const id = found.posts[0].id;
    console.log(`> Deleting existing post ${SLUG} (${id})`);
    await api('DELETE', `/posts/${id}/`);
  } else {
    console.log(`> No existing post with slug ${SLUG}, will create.`);
  }

  // 2. Create the new post.
  const body = {
    posts: [
      {
        title: 'Tufte CSS Kitchen Sink',
        slug: SLUG,
        custom_excerpt: 'A reference post exercising every Tufte CSS feature.',
        status: 'published',
        html: HTML,
      },
    ],
  };

  console.log('> Creating kitchen-sink post...');
  const created = await api('POST', '/posts/?source=html', body);
  const url = created.posts[0].url;
  console.log(`✓ Created: ${url}`);
  console.log(`  Slug:  ${SLUG}`);
  console.log(`  Status: ${created.posts[0].status}`);
}

main().catch((err) => {
  console.error('seed failed:', err.message);
  process.exit(1);
});
