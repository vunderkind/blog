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

exec docker-entrypoint.sh "$@"
