// Plugin loader — zero-cost when no plugin is used on a page.
// Usage inside any post (via an HTML card):
//   <div data-plugin="graph" data-src="/content/files/data.json"></div>
// The loader dynamically imports /assets/plugins/<name>/plugin.js
// and calls its default export: { init(el, opts) }.
//
// A plugin is just one file. Example: assets/plugins/hello/plugin.js
//   export default { init(el){ el.textContent = "hello"; } }

const THEME_ROOT = new URL('.', import.meta.url).pathname.replace(/\/js\/$/, '/');
const loaded = new Map();

async function load(name) {
  if (loaded.has(name)) return loaded.get(name);
  const url = `${THEME_ROOT}plugins/${name}/plugin.js`;
  const p = import(url).then(m => m.default || m).catch(err => {
    console.warn(`[plugin:${name}] failed to load`, err);
    return { init(el) { el.dataset.pluginError = '1'; } };
  });
  loaded.set(name, p);
  return p;
}

function mountAll(root = document) {
  root.querySelectorAll('[data-plugin]:not([data-plugin-mounted])').forEach(async el => {
    el.dataset.pluginMounted = '1';
    const name = el.dataset.plugin;
    const opts = { ...el.dataset };
    delete opts.plugin; delete opts.pluginMounted;
    const plugin = await load(name);
    try { plugin.init?.(el, opts); }
    catch (e) { console.warn(`[plugin:${name}] init threw`, e); }
  });
}

// Initial mount
mountAll();

// Re-mount when new content appears (e.g. after navigation or member gates)
new MutationObserver(muts => {
  for (const m of muts) if (m.addedNodes.length) mountAll(m.target);
}).observe(document.body, { childList: true, subtree: true });
