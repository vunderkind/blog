#!/usr/bin/env bash
# Deploy this blog to Fly.io.
#
# One-time prereq:
#   fly auth login
#
# Usage:
#   ./deploy.sh init   <app-name>    # first-time: create app, volume, set secrets
#   ./deploy.sh push                 # redeploy latest code
#   ./deploy.sh logs                 # tail production logs
#   ./deploy.sh ssh                  # shell into the running machine
#   ./deploy.sh status               # machine + volume status
#   ./deploy.sh secrets              # push mail secrets from .env to Fly

set -euo pipefail
cd "$(dirname "$0")"

require() { command -v "$1" >/dev/null || { echo "need $1 (brew install flyctl)"; exit 1; }; }
require fly

app_name() { grep -E '^app\s*=' fly.toml | head -1 | cut -d'"' -f2; }

cmd_init() {
  local name="${1:-}"
  [ -n "$name" ] || { echo "usage: ./deploy.sh init <app-name>"; exit 1; }

  echo "→ Creating Fly app: $name"
  fly apps create "$name" || echo "(app may already exist; continuing)"

  # Bake the name into fly.toml
  sed -i.bak "s/REPLACE-WITH-YOUR-APP-NAME/$name/g" fly.toml && rm -f fly.toml.bak

  local region
  region=$(grep -E '^primary_region' fly.toml | cut -d'"' -f2)

  echo "→ Creating 3GB volume 'ghost_content' in $region"
  fly volumes create ghost_content --region "$region" --size 3 --yes || \
    echo "(volume may already exist; continuing)"

  [ -f .env ] && cmd_secrets || echo "(no .env yet — skipping secrets; run ./deploy.sh secrets later)"

  echo "→ First deploy"
  fly deploy

  echo
  echo "──────────────────────────────────────────────────"
  echo "  Live at: https://$name.fly.dev"
  echo "  Finish setup: https://$name.fly.dev/ghost"
  echo "  Custom domain later: fly certs add your.domain.com"
  echo "──────────────────────────────────────────────────"
}

cmd_push()    { fly deploy; }
cmd_logs()    { fly logs; }
cmd_ssh()     { fly ssh console; }
cmd_status()  { fly status; fly volumes list; }

cmd_secrets() {
  [ -f .env ] || { echo "no .env file"; exit 1; }
  echo "→ Pushing secrets from .env to Fly"
  # Build the command dynamically from .env, skipping blanks and comments.
  local args=()
  while IFS='=' read -r k v; do
    [[ -z "$k" || "$k" =~ ^# ]] && continue
    # Strip surrounding quotes from value
    v="${v%\"}"; v="${v#\"}"
    # Map .env keys → Ghost nested env keys
    case "$k" in
      MAIL_SERVICE) args+=("mail__options__service=$v") ;;
      MAIL_HOST)    args+=("mail__options__host=$v") ;;
      MAIL_PORT)    args+=("mail__options__port=$v") ;;
      MAIL_USER)    args+=("mail__options__auth__user=$v") ;;
      MAIL_PASS)    args+=("mail__options__auth__pass=$v") ;;
      MAIL_FROM)    args+=("mail__from=$v") ;;
      MAILGUN_API_KEY)  args+=("bulkEmail__mailgun__apiKey=$v") ;;
      MAILGUN_DOMAIN)   args+=("bulkEmail__mailgun__domain=$v") ;;
      MAILGUN_BASE_URL) args+=("bulkEmail__mailgun__baseUrl=$v") ;;
    esac
  done < .env
  # Static ones
  args+=("mail__transport=SMTP" "mail__options__secure=false")
  fly secrets set "${args[@]}"
}

case "${1:-}" in
  init)    shift; cmd_init "$@" ;;
  push)    cmd_push ;;
  logs)    cmd_logs ;;
  ssh)     cmd_ssh ;;
  status)  cmd_status ;;
  secrets) cmd_secrets ;;
  *) sed -n '3,14p' "$0"; exit 1 ;;
esac
