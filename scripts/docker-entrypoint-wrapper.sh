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

# --- Litestream: replicate SQLite to R2 ---
DB=/var/lib/ghost/content/data/ghost.db
if [ -n "$LITESTREAM_BUCKET" ] && [ -x /usr/local/bin/litestream ]; then
  # If the local DB is missing but a replica exists, pull it back first.
  # This is the disaster-recovery path on a brand-new volume.
  if [ ! -f "$DB" ]; then
    echo "[litestream] no local DB — attempting restore from R2"
    mkdir -p "$(dirname "$DB")"
    /usr/local/bin/litestream restore -if-replica-exists -config /etc/litestream.yml "$DB" \
      || echo "[litestream] restore: no replica found (first boot, expected)"
  fi
  echo "[litestream] starting replicate"
  /usr/local/bin/litestream replicate -config /etc/litestream.yml &
else
  echo "[litestream] skipped (LITESTREAM_BUCKET not set or binary missing)"
fi

exec docker-entrypoint.sh "$@"
