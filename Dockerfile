# Ghost + our custom theme, baked into one image.
# Used by both local `docker compose` and Fly deploys.
FROM ghost:6-alpine

# Install Litestream for continuous SQLite replication to S3/R2.
# Pinned version to avoid surprises; bump as needed.
USER root
ARG LITESTREAM_VERSION=v0.3.14
RUN apk add --no-cache curl ca-certificates \
 && case "$(uname -m)" in \
      x86_64)  ARCH=amd64 ;; \
      aarch64) ARCH=arm64 ;; \
      *) echo "unsupported arch: $(uname -m)"; exit 1 ;; \
    esac \
 && curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-${ARCH}.tar.gz" \
    -o /tmp/litestream.tar.gz \
 && tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin \
 && rm /tmp/litestream.tar.gz \
 && chmod +x /usr/local/bin/litestream \
 && /usr/local/bin/litestream version

# Copy the theme into Ghost's themes directory. It will be auto-detected.
# Activating it is a one-time click in Ghost Admin → Settings → Design.
COPY --chown=node:node theme /var/lib/ghost/content.orig/themes/holey-fox

# Litestream config — replicates the Ghost SQLite DB to R2.
# The actual R2 credentials are passed in via Fly secrets at runtime
# and templated into env-vars that this YAML references.
COPY --chown=root:root scripts/litestream.yml /etc/litestream.yml

# Ghost's stock entrypoint only seeds /var/lib/ghost/content from
# /var/lib/ghost/content.orig if the live dir is empty. After the
# volume's first boot, theme updates baked into the image never reach
# the live themes/ dir. This wrapper copies content.orig/themes/* over
# every boot, so `fly deploy` actually ships theme changes. It also
# starts Litestream in the background before exec'ing Ghost.
COPY --chmod=0755 scripts/docker-entrypoint-wrapper.sh /usr/local/bin/sync-themes-and-start
ENTRYPOINT ["/usr/local/bin/sync-themes-and-start"]
CMD ["node", "current/index.js"]
