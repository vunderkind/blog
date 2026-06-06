#!/bin/sh
# Custom entrypoint:
#  1. Sync our theme from baked-image into the live volume so theme
#     changes baked at image-build time actually reach Ghost. (The
#     stock entrypoint only seeds the live themes/ dir if it's empty.)
#  2. Start Litestream in the background, replicating ghost.db to R2.
#  3. Exec Ghost as PID 1's child.
#
# We only touch our own theme. Ghost's built-in themes (casper/edition/
# source) are already symlinked between content.orig and content by the
# stock entrypoint; copying them onto themselves errors with "same file".
set -e

THEME_NAME="holey-fox"
SRC="/var/lib/ghost/content.orig/themes/$THEME_NAME"
DST="/var/lib/ghost/content/themes/$THEME_NAME"

if [ -d "$SRC" ]; then
  mkdir -p "$DST"
  cp -a "$SRC/." "$DST/"
  chown -R node:node "$DST" 2>/dev/null || true
  echo "[entrypoint] synced theme: $THEME_NAME"
fi

# --- Litestream: DISABLED (migrated to MySQL 8) ---
# Ghost now runs on MySQL (fly.toml: database__client=mysql), so SQLite
# replication is obsolete. MySQL is backed up separately (Fly volume snapshots
# + the mysqldump->R2 cron in mysql/backup/). Binary/config left in the image
# but intentionally not started.
echo "[litestream] disabled — Ghost runs on MySQL"

# Start the Caddy front proxy (see scripts/Caddyfile). It listens on :8080
# (Fly's internal_port) and routes /.ghost/analytics/* to the analytics
# sidecar, everything else to Ghost on :2368. Runs in the background so Ghost
# stays the main process. If Caddy can't start, we log loudly — but note the
# blog is only reachable through Caddy once internal_port=8080.
if [ -x /usr/bin/caddy ] && [ -f /etc/caddy/Caddyfile ]; then
  export XDG_DATA_HOME=/tmp/caddy XDG_CONFIG_HOME=/tmp/caddy
  mkdir -p /tmp/caddy
  if /usr/bin/caddy start --config /etc/caddy/Caddyfile --adapter caddyfile; then
    echo "[caddy] front proxy started on :8080"
  else
    echo "[caddy] WARNING: failed to start; Ghost still listening on :2368"
  fi
fi

exec docker-entrypoint.sh "$@"
