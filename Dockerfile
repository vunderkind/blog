# Ghost + our custom theme, baked into one image.
# Used by both local `docker compose` and Fly deploys.
FROM ghost:6-alpine

# Copy the theme into Ghost's themes directory. It will be auto-detected.
# Activating it is a one-time click in Ghost Admin → Settings → Design.
COPY --chown=node:node theme /var/lib/ghost/content.orig/themes/holey-fox

# Ghost's stock entrypoint only seeds /var/lib/ghost/content from
# /var/lib/ghost/content.orig if the live dir is empty. After the
# volume's first boot, theme updates baked into the image never reach
# the live themes/ dir. This wrapper copies content.orig/themes/* over
# every boot, so `fly deploy` actually ships theme changes.
COPY --chmod=0755 scripts/docker-entrypoint-wrapper.sh /usr/local/bin/sync-themes-and-start
ENTRYPOINT ["/usr/local/bin/sync-themes-and-start"]
CMD ["node", "current/index.js"]
