# Web analytics — architecture & runbook

Ghost 6 **native web analytics** (cookie-free, first-party, shown in **Admin →
Analytics**), backed by **Tinybird**. This file is the map: how it's wired, why
it's wired the unusual way it is, how to change it, and how to debug it when the
dashboard goes blank. Written to be picked up cold (by a human or an agent).

## TL;DR mental model

Two **independent** paths share one Tinybird workspace:

```
INGEST (write):
  browser ─ ghost-stats.js ─▶ POST https://gist.holeyfox.co/.ghost/analytics/api/v1/page_hit
    └▶ Fly edge (TLS) ─▶ Caddy :8080 ─(strip /.ghost/analytics)─▶ blogwai-analytics.internal:3000
         └▶ sidecar enriches (UA→browser/os/device, salted session) ─▶ Tinybird /v0/events → analytics_events

READ (dashboard):
  Admin → Analytics ─▶ Ghost mints a read-JWT (signed with tinybird__adminToken)
    └▶ browser queries Tinybird pipes directly (api_kpis, api_top_pages, …)
```

The one counter-intuitive fact that explains the whole design: **Ghost does NOT
serve `/.ghost/analytics`.** We run a tiny Caddy in front of Ghost to route that
path to the sidecar. Everything else below follows from that.

## Why it's not just "flip a setting"

This repo is a hand-rolled **Fly** deploy, not Ghost's official Docker Compose.
The official `compose.yml` bundles a **Caddy gateway** + a **traffic-analytics
sidecar**; a single-container Fly app has neither, so we reproduce both. Three
hard constraints (verified against Ghost 6.43.1 source) force the shape:

1. **Dashboard and tracker are the same switch.** `ghost_head` injects the
   tracker `if (settingsHelpers.isWebAnalyticsEnabled())`, and that's the same
   flag that lights up the dashboard. `isWebAnalyticsEnabled()` =
   `web_analytics` setting **AND** `web_analytics_configured`, and
   `_isValidTinybirdConfig()` requires **`tinybird:tracker:endpoint`**. So you
   cannot have the read-only dashboard without also emitting the tracker.
2. **The production tracker is tokenless.** `getTinybirdTrackerScript()` only
   adds `data-token` when `env !== 'production'`. In prod the browser posts with
   **no** Tinybird credential, so it *cannot* post straight to Tinybird — it must
   go through something that holds the token. That something is the sidecar.
3. **Nobody proxies `/.ghost/analytics` for free.** Upstream, a Caddy gateway
   (`ghost-docker/caddy/snippets/TrafficAnalytics`) does it. We don't have it, so
   Ghost returns 404 on that path until we add our own router.

Net: **dashboard ⇒ native tracker ⇒ sidecar ⇒ a proxy that routes
`/.ghost/analytics/*` to the sidecar.** That's exactly what's built.

## The pieces

| Thing | Where | Role |
|---|---|---|
| Ghost native config | Fly secrets on **`blogwai`** | turns the feature on; tells Ghost where to read stats + where the tracker posts |
| **Caddy** front proxy | `scripts/Caddyfile`, baked via `Dockerfile`, started in `scripts/docker-entrypoint-wrapper.sh` | routes `/.ghost/analytics/*` → sidecar, everything else → Ghost; **`fly.toml` `internal_port = 8080`** points the Fly edge at Caddy |
| **traffic-analytics sidecar** | `analytics/fly.toml` → Fly app **`blogwai-analytics`** | enriches page-hits + forwards to Tinybird; private-only on 6PN |
| native tracker | injected by Ghost into every page `<head>` (`/public/ghost-stats.min.js`) | the browser beacon; **was** a hand-rolled snippet in `theme/default.hbs` (now removed) |
| Tinybird workspace | `life_of_mogwai`, GCP `europe-west2` | stores events + serves the dashboard pipes; CLI auth in `.tinyb` (gitignored) |

Topology: `Fly edge (TLS, force_https) → Caddy :8080 → { Ghost :2368  |  blogwai-analytics.internal:3000 }`.
Ghost still listens on 2368; Caddy is just in front. `blogwai-mysql` is unrelated.

## Config reference (Fly secrets — NOT in `.env`)

**`blogwai`** (`fly secrets list --app blogwai`):

| Secret | Value | Purpose |
|---|---|---|
| `analytics__enabled` | `true` | enables Ghost's `/.ghost/analytics` proxy intent + feature |
| `analytics__url` | `http://blogwai-analytics.internal:3000` | where Ghost *thinks* analytics lives (we actually route via Caddy; harmless to keep aligned) |
| `tinybird__tracker__endpoint` | `https://gist.holeyfox.co/.ghost/analytics/api/v1/page_hit` | becomes the tracker's `data-host`; **required** for `web_analytics_configured` |
| `tinybird__tracker__datasource` | `analytics_events` | the Tinybird datasource name |
| `tinybird__adminToken` | workspace admin token (same value as `.tinyb`) | Ghost signs **dashboard read-JWTs** with this |
| `tinybird__workspaceId` | `1fe265e4-a164-4bbb-87ba-d942882d74e5` | the Tinybird workspace id |
| `tinybird__stats__endpoint` | `https://api.europe-west2.gcp.tinybird.co` | Tinybird API base the Admin browser reads from |

Plus the **Settings → Analytics** toggle must be on (`web_analytics = true` in
Ghost settings). Derived: `web_analytics_configured` and `web_analytics_enabled`
both flip `true` once the `tinybird__*` config is present.

**`blogwai-analytics`**: `TINYBIRD_TRACKER_TOKEN` — append-only token on
`analytics_events` (the workspace's `tracker` token). Other sidecar config is in
`analytics/fly.toml` `[env]` (`PROXY_TARGET`, `LISTEN_HOST=::`, salt store).

## Tinybird workspace

- Host `https://api.europe-west2.gcp.tinybird.co`, workspace `life_of_mogwai`
  (id `1fe265e4-…`). Datasource **`analytics_events`** (+ materialized views
  `_mv_hits`, `_mv_daily_pages`, `_mv_session_data_v2`). ~34 `api_*` pipes power
  the dashboard (`api_kpis*`, `api_top_pages*`, `api_top_sources*`,
  `api_top_locations*`, `api_active_visitors*`, UTM breakdowns…).
- Tokens: `tracker` (APPEND → used by the sidecar), `stats_page` (READ on the
  api pipes), plus the workspace admin token (in `.tinyb`).
- The datasources/pipes were **already deployed** to the workspace (the schema
  ships in the Ghost image under `core/server/data/tinybird/`); we did not
  re-run `tb deploy`.

## Reproduce from scratch

```bash
# 1) Sidecar (from analytics/)
fly apps create blogwai-analytics
# tracker token = workspace "tracker" token; read it from Tinybird:
TOK=$(python3 -c "import json;print(json.load(open('../.tinyb'))['token'])")
TRACKER=$(curl -s -H "Authorization: Bearer $TOK" \
  https://api.europe-west2.gcp.tinybird.co/v0/tokens/tracker | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
printf 'TINYBIRD_TRACKER_TOKEN=%s\n' "$TRACKER" | fly secrets import --app blogwai-analytics
fly deploy --config analytics/fly.toml --app blogwai-analytics --ha=false

# 2) Ghost native config (from repo root). adminToken = .tinyb token.
ADMIN=$(python3 -c "import json;print(json.load(open('.tinyb'))['token'])")
{ echo "analytics__enabled=true"
  echo "analytics__url=http://blogwai-analytics.internal:3000"
  echo "tinybird__tracker__endpoint=https://gist.holeyfox.co/.ghost/analytics/api/v1/page_hit"
  echo "tinybird__tracker__datasource=analytics_events"
  echo "tinybird__adminToken=$ADMIN"
  echo "tinybird__workspaceId=1fe265e4-a164-4bbb-87ba-d942882d74e5"
  echo "tinybird__stats__endpoint=https://api.europe-west2.gcp.tinybird.co"; } | fly secrets import --app blogwai

# 3) Ghost image already bundles Caddy (Dockerfile + scripts/Caddyfile) and
#    fly.toml internal_port=8080 — so just deploy the blog:
fly deploy --app blogwai

# 4) In Admin → Settings → Analytics, ensure "Web analytics" is ON.
```

## Operate & change

- **Upgrade the sidecar**: bump the pinned tag in `analytics/fly.toml`
  (`image = "ghost/traffic-analytics:X.Y.Z"`), then
  `fly deploy --config analytics/fly.toml --app blogwai-analytics --ha=false`.
  Sidecar machines without a `[http_service]` come back **stopped** after a
  config change — `fly machine start <id> --app blogwai-analytics` if so.
- **Change routing** (e.g. add another proxied path): edit `scripts/Caddyfile`,
  `caddy validate --adapter caddyfile --config scripts/Caddyfile` (local
  `brew install caddy`), then `fly deploy --app blogwai`.
- **Rotate the tracker token**: create a new APPEND token in Tinybird, update
  `TINYBIRD_TRACKER_TOKEN` on `blogwai-analytics`, redeploy that app. (No change
  to Ghost — the token never reaches the browser.)
- **Turn analytics off**: flip the **Settings → Analytics** toggle off (stops
  tracker injection + dashboard), or remove the `tinybird__*` secrets on
  `blogwai`. To fully revert the edge: set `fly.toml` `internal_port` back to
  `2368` and `fly deploy` — Fly then talks to Ghost directly, bypassing Caddy.

## Verify it's working

```bash
# Flags (expect all True):
#   web_analytics / web_analytics_configured / web_analytics_enabled
#   -> Admin settings API, or just open Admin → Analytics.

# End-to-end ingest (this exact shape returns 202 {"successful_rows":1}):
curl -s -X POST "https://gist.holeyfox.co/.ghost/analytics/api/v1/page_hit?name=analytics_events" \
  -H 'Content-Type: application/json' \
  -H 'x-site-uuid: c47a34fc-14ce-4560-9926-f09f1d2dfe4b' \
  -A 'Mozilla/5.0 … Chrome/126 Safari/537.36' \
  --data '{"timestamp":"2026-01-01T00:00:00.000Z","action":"page_hit","version":"1",
           "session_id":"<uuid>","payload":{"site_uuid":"c47a34fc-14ce-4560-9926-f09f1d2dfe4b",
           "member_uuid":"undefined","member_status":"undefined","post_uuid":"undefined",
           "post_type":"null","locale":"en-US","location":"","referrer":null,
           "pathname":"/__test__/","href":"https://gist.holeyfox.co/__test__/",
           "user-agent":"Mozilla/5.0 … Chrome/126"}}'
#   REQUIRED or you get 400: header `x-site-uuid`, and `payload.user-agent`.

# Confirm it landed (enriched browser/os/device proves the sidecar ran):
TOK=$(python3 -c "import json;print(json.load(open('.tinyb'))['token'])")
curl -s -G -H "Authorization: Bearer $TOK" \
  https://api.europe-west2.gcp.tinybird.co/v0/sql \
  --data-urlencode "q=SELECT timestamp, JSONExtractString(payload,'pathname') p,
    JSONExtractString(payload,'browser') br FROM analytics_events
    WHERE timestamp > now() - INTERVAL 5 MINUTE ORDER BY timestamp DESC LIMIT 5 FORMAT JSON"

# Sidecar reachable from the Ghost machine over 6PN (expect HTTP 200):
fly ssh console --app blogwai -C \
  "curl -s -m6 -o /dev/null -w '%{http_code}\n' http://blogwai-analytics.internal:3000/"

# Sidecar logs:  fly logs --app blogwai-analytics --no-tail | tail
# Clean up a test event (async delete job):
#   curl -s -X POST .../v0/datasources/analytics_events/delete -H "Authorization: Bearer $TOK" \
#     --data-urlencode "delete_condition=JSONExtractString(payload,'pathname') = '/__test__/'"
```

## Debugging (symptom → cause → fix)

| Symptom | Likely cause | Fix |
|---|---|---|
| `POST /.ghost/analytics/…` → **404** (`x-powered-by: Express`) | Caddy not routing — `internal_port` isn't 8080, or Caddy didn't start | check `fly.toml internal_port=8080`; `fly logs --app blogwai \| grep caddy` should show `front proxy started on :8080` |
| sidecar **400** "must have required property 'user-agent' / 'x-site-uuid'" | request missing `payload.user-agent` or the `x-site-uuid` header | the real `ghost-stats.js` sends both; only an issue for synthetic tests |
| `curl … internal:3000` → **000** / connection refused | sidecar down, OOM-looped, or bound IPv4-only | `fly machine status`; ensure `LISTEN_HOST=::` and `memory=512mb` |
| sidecar **exit_code=137, oom_killed** | 256 MB is too small | `memory = "512mb"` in `analytics/fly.toml` |
| **dashboard blank** but data exists in Tinybird | `web_analytics_configured=false` (missing `tinybird__*`) or toggle off | set the `tinybird__*` secrets; turn on Settings → Analytics |
| blog **redirect loop** after a Caddy change | Caddy sent `X-Forwarded-Proto: http` to Ghost | keep `header_up X-Forwarded-Proto https` + `trusted_proxies static private_ranges` in `scripts/Caddyfile` |

## Gotchas (the short list)

- **`LISTEN_HOST=::`** — the sidecar image reads `LISTEN_HOST` (not `HOST`) and
  defaults to IPv4-only `0.0.0.0`; Fly's 6PN/`​.internal` is **IPv6-only**, so
  without `::` it's unreachable (binds IPv4, `.internal` can't connect).
- **512 MB minimum** — 256 MB OOM-kills `node --enable-source-maps` on boot.
- **`internal_port = 8080`** — Caddy is the entrypoint the Fly edge hits; Ghost
  stays on 2368 behind it. Flip back to 2368 to bypass Caddy (rollback).
- **One flag, two effects** — the Analytics toggle drives *both* the dashboard
  and the injected tracker. There is no read-only mode.
- **Tokenless prod tracker** — the browser never holds a Tinybird token in
  production, which is the whole reason the sidecar (not direct-to-Tinybird) is
  mandatory.

## Known limitations / watch items

- **Locations** — country is **client-side, timezone-derived**, NOT IP geo. The
  tracker maps `Intl…resolvedOptions().timeZone` → a country and sends it as
  `payload.location`; the sidecar/Tinybird never touch it (the datasource
  doesn't even store the IP — `mv_hits` does `JSONExtractString(payload,
  'location')` and `api_top_locations` does `GROUP BY location`). Consequences:
  (a) it's approximate — VPNs / ambiguous zones land as "Unknown"; (b) **every
  pre-migration DIY row is "Unknown"** because the old snippet hardcoded
  `location:''`; (c) it only fills in as **native** traffic accrues, so the
  dashboard stays mostly "Unknown" until the DIY rows age out of the window.
  Verified end-to-end: a hit with `location:'US'` shows as `US` in
  `api_top_locations_v2`. Nothing to fix in the pipeline — it just needs native
  hits. (If you want the history clean now, you could delete the old
  `location=''` rows from `analytics_events`, but that drops real pageview
  counts too.)
- **Member / post attribution** — the tracker carries `tb_member_uuid` /
  `tb_post_uuid`; confirm these populate for logged-in members and on posts (the
  old DIY snippet hardcoded them to `undefined`).
- **Cost** — `blogwai-analytics` is an always-on `shared-cpu-1x` / 512 MB
  machine ≈ **$3/mo**.

## History

Before this, analytics was a **DIY snippet** in `theme/default.hbs`: an inline
`<script>` that POSTed `page_hit`s straight to Tinybird with a hardcoded
APPEND token (it predated wiring Ghost's native feature). It worked but had no
in-Admin dashboard, no UA enrichment, and no member/post attribution. It was
removed when native ingestion went live (see git history of `theme/default.hbs`).
