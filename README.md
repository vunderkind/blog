# Blog

Self-hosted blog. Built on **Ghost** so email subscriptions, paid memberships (Stripe), and the admin UI come free. The custom theme (`theme/`) is minimal and ships a lazy-loaded plugin system for your own extensions.

## What you get

- **Email subscriptions** — free + paid tiers, managed entirely in Ghost Admin.
- **Stripe payments** — connect in Admin → Settings → Membership. Keys live in the DB, not in `.env`.
- **Newsletter delivery** — via Mailgun (Ghost requires Mailgun for bulk send).
- **Portable** — single `docker-compose up -d`. SQLite on a volume. Runs on any VPS, Fly, Railway, or your laptop.
- **Plugins** — drop a single ES module into `theme/assets/plugins/<name>/plugin.js`, reference it from any post via `<div data-plugin="<name>">`. Loaded only on pages that use it. See [theme/assets/plugins/README.md](theme/assets/plugins/README.md).
- **Homepage budget** — inlined CSS (~2KB), loader JS (~1.6KB), no webfonts. Ghost's Portal script (for sign-in/subscribe) is the main cost and loads async; total homepage stays well under 100KB.

## Run it locally

```bash
cp .env.example .env
# edit .env — at minimum, set SITE_DOMAIN=:80 and SITE_URL=http://localhost
docker compose up -d
open http://localhost/ghost   # finish setup: create owner account
```

## Deploy to Fly.io

```bash
brew install flyctl          # if not installed
fly auth login               # one-time

./deploy.sh init my-blog     # creates app, 3GB volume, deploys
./deploy.sh secrets          # push mail creds from .env (optional, can skip)
./deploy.sh push             # redeploy after local changes
./deploy.sh logs             # tail production
./deploy.sh ssh              # shell in
```

Live at `https://my-blog.fly.dev` on first deploy, free TLS. Add a custom
domain later with `fly certs add blog.yourdomain.com` (then CNAME it to
`my-blog.fly.dev`).

**Cost**: `shared-cpu-1x` 1GB VM + 3GB volume ≈ **$6/mo raw**, offset by
Fly's $5/mo usage credit → effectively **$1–2/mo** for a small blog.

## Persistence

Ghost keeps everything — posts, members, Stripe customer IDs, uploaded images,
settings — in `/var/lib/ghost/content` (SQLite at `data/ghost.db` plus image
dirs). A Fly **volume** (`ghost_content`, 3GB) is mounted there.

What survives:
- `fly deploy` / new image builds ✓
- Machine restarts, crashes, OOM kills ✓
- Scaling the VM up/down ✓
- Fly takes automatic **daily snapshots** retained for 5 days ✓

What doesn't:
- Explicit `fly volumes destroy` or `fly apps destroy` (obviously)
- Catastrophic host failure between snapshots (unlikely, but the window exists)

**Recommended upgrade for real data:** add [Litestream](https://litestream.io)
to continuously replicate `ghost.db` to S3 / Cloudflare R2 (~$0.15/mo). A
one-container sidecar in the Dockerfile gets you point-in-time recovery. Not
wired up by default because it needs R2/S3 credentials — ask and I'll add it.

Then in Ghost Admin:

1. **Settings → Membership** → connect Stripe (test keys first).
2. **Settings → Design** → change active theme to **Minima** (it's mounted from `./theme`).
3. **Settings → Email newsletter** → set sender address.

## Adding a plugin

```bash
mkdir -p theme/assets/plugins/myviz
cat > theme/assets/plugins/myviz/plugin.js <<'JS'
export default { init(el, opts) { el.textContent = 'hello ' + (opts.name ?? ''); } };
JS
```

Insert an HTML card in any post:

```html
<div data-plugin="myviz" data-name="world"></div>
```

That's the whole contract. The loader dynamically imports your module only on pages that contain the element. See the shipped `graph` and `sparkline` examples.

## Layout

```
blog/
├── docker-compose.yml     # Ghost + SQLite, env-driven
├── .env.example           # mail, mailgun, URL, port
└── theme/                 # mounted into Ghost as the "minima" theme
    ├── package.json
    ├── default.hbs        # base layout (inlines critical CSS)
    ├── index.hbs          # homepage
    ├── post.hbs           # single post
    ├── page.hbs           # static pages
    ├── partials/
    │   └── inline-css.hbs # the entire site's CSS, inlined
    └── assets/
        ├── js/plugins.js  # lazy plugin loader
        └── plugins/
            ├── graph/     # example: animated canvas graph
            └── sparkline/ # example: inline SVG sparkline
```

## Deploying

The compose file is the deployable unit. On a VPS:

```bash
# set SITE_URL in .env to your domain (e.g. https://blog.example.com)
docker compose up -d
```

Put Caddy or Nginx in front for TLS. The `ghost-content` volume holds your DB, uploads, and any extra themes — back it up.

## Why Ghost and not WordPress / Substack / from-scratch

- **vs Substack**: you asked for self-hosted, and you want plugins. Substack gives neither.
- **vs WordPress**: WP's plugin ecosystem is huge but the homepage budget is hostile, and you'd be fighting the platform to stay under 100KB. Ghost is already lean.
- **vs from-scratch**: member management + Stripe + newsletter delivery is a multi-month build. Ghost ships it.

Your extensibility story lives in the **theme-level plugin loader**, which is exactly where custom visualizers and animations belong anyway. The CMS stays stable; the creative layer is yours.
