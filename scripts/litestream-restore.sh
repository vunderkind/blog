#!/usr/bin/env bash
# Disaster recovery: pull ghost.db back from R2 onto a local file.
#
# Usage (against your own machine, just to inspect a backup):
#   export LITESTREAM_BUCKET=...
#   export LITESTREAM_ENDPOINT=...
#   export LITESTREAM_ACCESS_KEY_ID=...
#   export LITESTREAM_SECRET_ACCESS_KEY=...
#   ./scripts/litestream-restore.sh /tmp/ghost.db
#
# To restore directly into the running Fly machine, ssh in first and
# stop Ghost (or accept brief downtime), then run:
#   fly ssh console -a blogwai
#   /usr/local/bin/litestream restore -config /etc/litestream.yml \
#       -o /tmp/ghost.restored.db
#   mv /tmp/ghost.restored.db /var/lib/ghost/content/data/ghost.db
#   exit
#   fly machine restart <id> -a blogwai
set -euo pipefail
OUT="${1:-/tmp/ghost.restored.db}"
: "${LITESTREAM_BUCKET:?must set LITESTREAM_BUCKET}"
: "${LITESTREAM_ENDPOINT:?must set LITESTREAM_ENDPOINT}"
: "${LITESTREAM_ACCESS_KEY_ID:?must set LITESTREAM_ACCESS_KEY_ID}"
: "${LITESTREAM_SECRET_ACCESS_KEY:?must set LITESTREAM_SECRET_ACCESS_KEY}"

if ! command -v litestream >/dev/null; then
  echo "litestream not installed locally. brew install benbjohnson/litestream/litestream" >&2
  exit 1
fi

CFG=$(mktemp)
trap 'rm -f $CFG' EXIT
cat > "$CFG" <<YAML
dbs:
  - path: $OUT
    replicas:
      - type: s3
        bucket: ${LITESTREAM_BUCKET}
        path: ghost.db
        endpoint: ${LITESTREAM_ENDPOINT}
        force-path-style: true
        access-key-id: ${LITESTREAM_ACCESS_KEY_ID}
        secret-access-key: ${LITESTREAM_SECRET_ACCESS_KEY}
YAML

echo "→ restoring from R2 → $OUT"
litestream restore -config "$CFG" "$OUT"
echo "✓ restored. Inspect with: sqlite3 $OUT 'SELECT count(*) FROM posts'"
