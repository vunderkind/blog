#!/usr/bin/env node
/**
 * Push code injection (Site Header + Site Footer) to Ghost Admin
 * via the settings API. Used to style Ghost Portal's iframe to
 * match the Life of Mogwai (Tufte) theme — black bg, et-book serif,
 * clean form fields, no rounded corners.
 *
 * Reads GHOST_ADMIN_API_KEY from .env, signs a 5-min JWT, PUTs
 * /admin/settings/ with codeinjection_head + codeinjection_foot.
 */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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
  console.error('error: GHOST_ADMIN_API_KEY missing or malformed');
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
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}\n${txt.slice(0, 500)}`);
  return txt ? JSON.parse(txt) : null;
}

// --------- Code Injection content ----------

const HEAD = `<style>
/* Tufte palette signal for any portal-aware components that read it. */
:root { --ghost-accent-color: #111; }
</style>`;

const FOOT = `<script>
/* Inject Tufte styling into Ghost Portal's iframe. Portal renders
   inside a same-origin iframe; we reach into contentDocument and
   add a <style> on every load. Re-injects when Portal swaps state
   (signup/signin/account screens). */
(function () {
  var TUFTE_CSS = [
    '@font-face{font-family:"et-book";',
    'src:url("/assets/fonts/et-book/et-book-roman-line-figures/et-book-roman-line-figures.woff2") format("woff2"),',
    'url("/assets/fonts/et-book/et-book-roman-line-figures/et-book-roman-line-figures.woff") format("woff");',
    'font-weight:normal;font-style:normal;font-display:swap}',
    '@font-face{font-family:"et-book";',
    'src:url("/assets/fonts/et-book/et-book-display-italic-old-style-figures/et-book-display-italic-old-style-figures.woff2") format("woff2");',
    'font-weight:normal;font-style:italic;font-display:swap}',
    '@font-face{font-family:"et-book";',
    'src:url("/assets/fonts/et-book/et-book-bold-line-figures/et-book-bold-line-figures.woff2") format("woff2");',
    'font-weight:bold;font-style:normal;font-display:swap}',

    '*,*::before,*::after{box-sizing:border-box}',
    'html,body,.gh-portal-popup-container,.gh-portal-content,.gh-portal-popup-wrapper,',
    '.gh-portal-popup-background{',
    'background:#fffff8 !important;color:#111 !important;',
    'font-family:et-book,Palatino,"Palatino Linotype","Book Antiqua",Georgia,serif !important;',
    'font-size:15px !important}',

    /* Title styled like the site logo: Gill Sans small-caps, modest size */
    '.gh-portal-main-title{font-family:"Gill Sans","Gill Sans MT",Calibri,sans-serif !important;',
    'font-weight:400 !important;font-style:normal !important;',
    'font-variant:small-caps !important;letter-spacing:0.06em !important;',
    'font-size:1.4rem !important;line-height:1.2 !important}',
    'h1{font-family:et-book,Palatino,serif !important;font-weight:400 !important;',
    'font-style:normal !important;letter-spacing:0 !important;',
    'font-size:2.4rem !important;line-height:1.1 !important}',
    'h2,h3{font-family:et-book,Palatino,serif !important;font-weight:400 !important;',
    'font-style:italic !important;letter-spacing:0 !important}',

    /* Default ghost-portal-btn = NEUTRAL (transparent). Specific primary
       classes get the black-CTA treatment. Toggle/back inherit neutral. */
    '.gh-portal-btn{background:transparent !important;color:#111 !important;',
    'border:0 !important;border-radius:0 !important;box-shadow:none !important;',
    'font-family:"Gill Sans","Gill Sans MT",Calibri,sans-serif !important;',
    'letter-spacing:0.03em !important;text-transform:none !important;',
    'font-weight:400 !important;padding:0.55rem 1.1rem !important}',

    /* Primary CTAs: Continue, Choose, Subscribe, Sign in.
       Kwik-style rounded pill, generous padding. */
    '.gh-portal-btn-main,.gh-portal-btn-primary,.gh-portal-btn-branded,',
    '.gh-portal-signup-btn,button[type="submit"]{',
    'background:#111 !important;color:#fffff8 !important;',
    'border:1px solid #111 !important;border-radius:9999px !important;',
    'padding:0.85rem 1.8rem !important;font-size:1rem !important}',
    '.gh-portal-btn-main:hover,.gh-portal-btn-primary:hover,',
    '.gh-portal-btn-branded:hover{background:#333 !important;border-color:#333 !important}',

    /* Back button (top-left): subtle text-only, not a CTA */
    '.gh-portal-btn-site-title-back,[class*="site-title-back"],',
    '[class*="-back"]:not([class*="background"]){',
    'background:transparent !important;color:#111 !important;border:0 !important;',
    'opacity:0.55 !important;font-size:0.95rem !important;padding:0.4rem 0 !important}',
    '.gh-portal-btn-site-title-back:hover{opacity:1 !important;background:transparent !important}',

    /* Monthly/Yearly toggle: smaller text, refined pill */
    '.gh-portal-products-pricetoggle{background:transparent !important;',
    'border:1px solid #111 !important;border-radius:9999px !important;',
    'padding:0.15rem !important;display:inline-flex !important;gap:0.1rem !important}',
    '.gh-portal-products-pricetoggle .gh-portal-btn{',
    'background:transparent !important;color:#111 !important;',
    'font-size:0.85rem !important;font-weight:400 !important;',
    'border-radius:9999px !important;padding:0.35rem 0.9rem !important}',
    '.gh-portal-products-pricetoggle .gh-portal-btn.active{',
    'background:#111 !important;color:#fffff8 !important}',

    /* Link-style buttons */
    '.gh-portal-btn-text,.gh-portal-btn-link{',
    'background:transparent !important;color:#111 !important;',
    'text-decoration:underline !important;text-underline-offset:0.1em !important;',
    'text-decoration-thickness:0.05em !important;',
    'font-family:et-book,Palatino,serif !important;font-style:italic !important;',
    'font-size:1rem !important;padding:0 !important}',

    /* Choose / Continue product CTAs — pill-shaped Kwik-style.
       Portal also paints a white linear-gradient via ::before that
       was hiding our black button — kill that pseudo-element. */
    '.gh-portal-btn-product{',
    'background:#111 !important;border-radius:9999px !important;',
    'border:0 !important;box-shadow:none !important;padding:0 !important;',
    'margin:0.5rem 0 0 0 !important;position:relative !important}',
    '.gh-portal-btn-product::before,.gh-portal-btn-product::after{',
    'display:none !important;content:none !important;background:none !important}',
    '.gh-portal-btn-product .gh-portal-btn{',
    'background:transparent !important;color:#fffff8 !important;',
    'font-family:"Gill Sans","Gill Sans MT",Calibri,sans-serif !important;',
    'letter-spacing:0.03em !important;font-weight:400 !important;',
    'font-size:1rem !important;line-height:1 !important;',
    'border-radius:9999px !important;',
    'padding:0.85rem 1rem !important;width:100% !important}',
    '.gh-portal-btn-product:hover{background:#333 !important}',

    /* "Already a member? Sign in" footer */
    '.gh-portal-signup-message{',
    'font-family:et-book,Palatino,serif !important;',
    'font-size:1rem !important;font-style:italic !important;',
    'color:#111 !important;display:flex !important;',
    'gap:0.4rem !important;align-items:baseline !important;justify-content:center !important}',
    '.gh-portal-signup-message > div{font-style:italic !important;color:#111 !important}',
    '.gh-portal-signup-message .gh-portal-btn-link{',
    'background:transparent !important;color:#111 !important;',
    'font-style:italic !important;text-decoration:underline !important;',
    'text-underline-offset:0.1em !important;text-decoration-thickness:0.05em !important;',
    'padding:0 !important;font-weight:400 !important}',

    /* Inputs: Tufte-style, single horizontal rule under each field */
    'input,select,textarea,.gh-portal-input{',
    'border:0 !important;border-bottom:1px solid #111 !important;',
    'border-radius:0 !important;background:transparent !important;color:#111 !important;',
    'font-family:et-book,Palatino,serif !important;font-size:1rem !important;',
    'padding:0.4rem 0 !important;box-shadow:none !important}',
    'input:focus,select:focus,textarea:focus,.gh-portal-input:focus{',
    'border-bottom-width:2px !important;outline:0 !important;box-shadow:none !important}',
    'label,.gh-portal-input-label{',
    'font-family:"Gill Sans","Gill Sans MT",Calibri,sans-serif !important;',
    'letter-spacing:0.03em !important;color:#111 !important;',
    'text-transform:none !important;font-weight:400 !important}',

    /* Tier cards: subtle border, generous padding, soft rounded corners
       (Kwik aesthetic — clean but not boxy). */
    '.gh-portal-product-card,.gh-portal-products .gh-portal-product-card{',
    'border:1px solid #e6e6df !important;border-radius:8px !important;',
    'background:transparent !important;box-shadow:none !important;',
    'padding:2rem 1.75rem !important}',
    '.gh-portal-product-card.checked,.gh-portal-product-card-selected{',
    'border:1px solid #111 !important}',
    /* Remove the inner card-header double-border */
    '.gh-portal-product-card-header,.gh-portal-product-priceoption{',
    'border:0 !important;background:transparent !important;padding:0 !important;',
    'box-shadow:none !important}',
    '.gh-portal-product-card-name{font-style:italic !important;color:#111 !important;',
    'font-weight:400 !important}',
    '.gh-portal-product-card-price,.gh-portal-product-card-pricecontainer{',
    'font-family:et-book,serif !important;color:#111 !important}',

    /* Discount labels: subtle italic instead of gray pill — kill the
       pill border-radius and trim the font-size. */
    '.gh-portal-discount-label,.gh-portal-pricetoggle-discount,',
    '.gh-portal-maximum-discount{',
    'background:transparent !important;color:#111 !important;border:0 !important;',
    'border-radius:0 !important;box-shadow:none !important;',
    'font-family:et-book,serif !important;font-style:italic !important;',
    'font-weight:400 !important;letter-spacing:0 !important;',
    'font-size:0.95rem !important;',
    'padding:0 0 0 0.4em !important;opacity:0.6}',

    'a,.gh-portal-link,.gh-portal-signup-message a{',
    'color:#111 !important;text-decoration:underline !important;',
    'text-underline-offset:0.1em !important;text-decoration-thickness:0.05em !important}',

    '.gh-portal-input-error,.error,[class*="error"]{color:#c33 !important}',

    '.gh-portal-powered{display:none !important}',

    '@media (prefers-color-scheme: dark){',
    'html,body,.gh-portal-popup-container,.gh-portal-content,.gh-portal-popup-wrapper,',
    '.gh-portal-popup-background{background:#151515 !important;color:#ddd !important}',
    'input,select,textarea,.gh-portal-input{color:#ddd !important;border-color:#444 !important}',
    'input:focus,.gh-portal-input:focus{border-color:#ddd !important}',
    '.gh-portal-btn,.gh-portal-btn-main,.gh-portal-btn-primary,.gh-portal-btn-branded{',
    'background:#ddd !important;color:#151515 !important}',
    '.gh-portal-btn:hover,.gh-portal-btn-main:hover{background:#aaa !important}',
    '.gh-portal-product-card{border-color:#444 !important}',
    '.gh-portal-product-card.checked{border-color:#ddd !important}',
    '.gh-portal-priceoptions .selected,.gh-portal-priceoptions [aria-checked="true"]{',
    'background:#ddd !important;color:#151515 !important}',
    'a,.gh-portal-link{color:#ddd !important}',
    '}'
  ].join('');

  function injectOnce(iframe) {
    try {
      var doc = iframe.contentDocument;
      if (!doc || !(doc.head || doc.documentElement)) return false;
      if (doc.getElementById('tufte-portal-styles')) return true;
      var style = doc.createElement('style');
      style.id = 'tufte-portal-styles';
      style.textContent = TUFTE_CSS;
      (doc.head || doc.documentElement).appendChild(style);
      return true;
    } catch (e) { return false; }
  }

  /* Aggressive inject: keep retrying via rAF until our <style> is in
     the iframe's <head>. Catches Portal before its first paint, which
     is what eliminates the FOUT. Caps at ~1.5s of attempts. */
  function injectAggressive(iframe) {
    if (iframe.dataset.tufteInjected === '1') { injectOnce(iframe); return; }
    var attempts = 0;
    function tick() {
      if (injectOnce(iframe)) {
        iframe.dataset.tufteInjected = '1';
        return;
      }
      if (++attempts < 90) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function isPortalFrame(iframe) {
    var id = iframe.id || '';
    var src = iframe.src || '';
    var title = iframe.title || '';
    return /portal|ghost-frame|members/i.test(id)
        || /portal/i.test(src)
        || /portal/i.test(title);
  }

  function findAndInject() {
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) {
      var iframe = frames[i];
      if (!isPortalFrame(iframe)) continue;
      if (!iframe.dataset.tufteWatched) {
        iframe.dataset.tufteWatched = '1';
        iframe.addEventListener('load', function (ev) {
          /* Re-inject on load: Portal swaps state across signup/signin
             screens which may replace our style. */
          ev.target.dataset.tufteInjected = '0';
          injectAggressive(ev.target);
        });
      }
      injectAggressive(iframe);
      return true;
    }
    return false;
  }

  /* Lazy strategy: only start looking for the Portal iframe AFTER the
     user clicks anything that opens Portal. No MutationObserver, no
     polling on idle pages. Click → poll briefly via rAF until we
     spot the iframe → inject → stop. */
  function watchForPortalFrame() {
    if (findAndInject()) return;
    var attempts = 0;
    function tick() {
      if (findAndInject()) return;
      if (++attempts < 90) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* Catch anything that triggers Portal:
     - <button data-portal="signup">
     - <a href="#/portal/signup"> (Substack-imported kg-button-card)
     - <a href="#/portal/account/...">
     Run watchForPortalFrame on the FIRST mousedown so styles are ready
     before the modal renders. Capture phase to beat Portal's own handlers. */
  function isPortalTrigger(el) {
    while (el && el !== document) {
      if (el.dataset && 'portal' in el.dataset) return true;
      if (el.getAttribute) {
        var href = el.getAttribute('href') || '';
        if (href.indexOf('#/portal') === 0 || href.indexOf('#/signin') === 0) return true;
      }
      el = el.parentNode;
    }
    return false;
  }
  /* Use both pointerdown (early, real users) and click (programmatic
     .click() calls + assistive tech). Capture phase to beat Portal's
     own handlers. */
  function onTrigger(e) { if (isPortalTrigger(e.target)) watchForPortalFrame(); }
  document.addEventListener('pointerdown', onTrigger, true);
  document.addEventListener('click', onTrigger, true);
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && isPortalTrigger(e.target)) {
      watchForPortalFrame();
    }
  }, true);

  /* Edge case: Portal can auto-open on certain URLs (#/portal/...).
     One-shot check after page load; no ongoing observer. */
  if (location.hash.indexOf('#/portal') === 0 || location.hash.indexOf('#/signin') === 0) {
    watchForPortalFrame();
  }
})();
</script>`;

// --------- main ----------

async function main() {
  console.log('# Reading current settings...');
  const cur = await api('GET', '/settings/');
  const findVal = (k) => (cur.settings.find((s) => s.key === k) || {}).value;
  const headBefore = findVal('codeinjection_head') || '';
  const footBefore = findVal('codeinjection_foot') || '';
  console.log(`  head_len(before): ${headBefore.length}`);
  console.log(`  foot_len(before): ${footBefore.length}`);

  console.log('# Pushing new code injection...');
  const body = {
    settings: [
      { key: 'codeinjection_head', value: HEAD },
      { key: 'codeinjection_foot', value: FOOT },
    ],
  };
  await api('PUT', '/settings/', body);
  console.log('✓ pushed');

  console.log('# Verifying...');
  const after = await api('GET', '/settings/');
  const findVal2 = (k) => (after.settings.find((s) => s.key === k) || {}).value;
  console.log(`  head_len(after): ${(findVal2('codeinjection_head') || '').length}`);
  console.log(`  foot_len(after): ${(findVal2('codeinjection_foot') || '').length}`);
}

main().catch((e) => {
  console.error('fatal:', e.message);
  process.exit(1);
});
