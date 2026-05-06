# Plugins

Drop-in, lazy-loaded extensions. One folder per plugin, one file per plugin.

## Authoring

```
theme/assets/plugins/myplugin/plugin.js
```

```js
export default {
  init(el, opts) {
    // el  — the host element
    // opts — every data-* attribute on the element (minus data-plugin)
    el.textContent = `hello ${opts.name ?? 'world'}`;
  }
};
```

## Using in a post

In Ghost's editor, insert an **HTML card** (`/html`) and drop:

```html
<div data-plugin="myplugin" data-name="Justin"></div>
```

The loader finds it, imports your module, and calls `init(el, opts)`.

## Rules

- A plugin is only fetched on pages where it's actually used — the homepage stays at zero JS cost.
- Plugins are ES modules. Use `import()` for sub-deps so they also load on demand.
- Clean up with a `MutationObserver` if you start animations/timers.
- Hot reload in dev: bump the filename query (`data-plugin="myplugin?v=2"`) — Ghost's theme watcher will have re-uploaded on save.

## Shipped examples

- `graph` — animated canvas graph.
- `sparkline` — inline SVG sparkline from `data-values`.
