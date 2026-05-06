#!/bin/sh
# Custom entrypoint that syncs the minima theme from the baked image to
# the live volume before handing control to Ghost's stock entrypoint.
# Without this, theme changes baked at image-build time never reach
# /var/lib/ghost/content/themes/minima after the volume's first boot.
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

exec docker-entrypoint.sh "$@"
