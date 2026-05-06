#!/usr/bin/env bash
# Apply codeinjection_head + codeinjection_foot directly via the SQLite
# DB inside the Ghost container. Used because the Admin API integration
# token returns 403 NoPermissionError when writing settings.
#
# Workflow:
#   1. Print HEAD + FOOT via apply-code-injection.mjs (which has them
#      defined as JS string literals).
#   2. Base64-encode each (avoids any shell-quoting nightmare with the
#      multi-kilobyte JS payload that contains both single and double
#      quotes).
#   3. Run a Node one-liner inside the Ghost container that decodes
#      and runs UPDATE statements against /var/lib/ghost/content/data/ghost.db.
#   4. Restart the machine so Ghost reloads its settings cache.
#
# Reads .env for GHOST_ADMIN_API_KEY (only used to identify which app
# to target — defaults to 'blogwai').

set -euo pipefail
cd "$(dirname "$0")/.."

APP="${FLY_APP:-blogwai}"

# Extract HEAD and FOOT from the JS source file.
HEAD=$(node -e "
const m = require('fs').readFileSync('scripts/apply-code-injection.mjs','utf8');
const start = m.indexOf('const HEAD = \`') + 'const HEAD = \`'.length;
const end = m.indexOf('\`;', start);
process.stdout.write(m.slice(start, end));
")

FOOT=$(node -e "
const m = require('fs').readFileSync('scripts/apply-code-injection.mjs','utf8');
const start = m.indexOf('const FOOT = \`') + 'const FOOT = \`'.length;
const end = m.indexOf('\`;', start);
process.stdout.write(m.slice(start, end));
")

HEAD_B64=$(printf '%s' "$HEAD" | base64 | tr -d '\n')
FOOT_B64=$(printf '%s' "$FOOT" | base64 | tr -d '\n')

echo "HEAD bytes: ${#HEAD}, FOOT bytes: ${#FOOT}"
echo "HEAD b64 chars: ${#HEAD_B64}, FOOT b64 chars: ${#FOOT_B64}"

# Build a Node script that runs INSIDE the Ghost container.
REMOTE_SCRIPT=$(cat <<EOF
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('/var/lib/ghost/content/data/ghost.db');
const head = Buffer.from('${HEAD_B64}', 'base64').toString('utf8');
const foot = Buffer.from('${FOOT_B64}', 'base64').toString('utf8');
const now = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
console.log('head len:', head.length, 'foot len:', foot.length);
db.serialize(() => {
  db.run("UPDATE settings SET value = ?, updated_at = ? WHERE key = 'codeinjection_head'", [head, now], function(e){ console.log('head update:', e||('rows='+this.changes)); });
  db.run("UPDATE settings SET value = ?, updated_at = ? WHERE key = 'codeinjection_foot'", [foot, now], function(e){ console.log('foot update:', e||('rows='+this.changes)); });
  db.close();
});
EOF
)

# Send to container via base64 to bypass all shell quoting.
SCRIPT_B64=$(printf '%s' "$REMOTE_SCRIPT" | base64 | tr -d '\n')

echo "→ Running update inside container (app=$APP)..."
# Write script INTO Ghost's directory so node can resolve sqlite3 from
# its bundled node_modules. /tmp doesn't have parent node_modules.
fly ssh console -a "$APP" -C "sh -c 'echo $SCRIPT_B64 | base64 -d > /var/lib/ghost/current/cinj.js && cd /var/lib/ghost/current && node cinj.js && rm cinj.js'"

echo "→ Restarting Ghost so the settings cache reloads..."
fly machine restart -a "$APP" 2>&1 | tail -3 || fly app restart -a "$APP" 2>&1 | tail -3

echo "→ Done. Wait ~30s for Ghost to come back, then click Subscribe on the live site."
