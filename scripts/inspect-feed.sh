#!/usr/bin/env bash
# Canvas calendar stats for one Telegram user from production, read-only. Never prints the feed URL.
# Usage: scripts/inspect-feed.sh <telegram_user_id> | --local <db> <telegram_user_id>
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" == "--local" ]]; then
  NODE_PATH=apps/server/node_modules node scripts/inspect/feed.cjs "$2" "$3"
  exit
fi
USER_ID="${1:?usage: inspect-feed.sh <telegram_user_id>}"
[[ "$USER_ID" =~ ^-?[0-9]+$ ]] || { echo "telegram_user_id must be a number"; exit 2; }
curl -sf -m 60 "${PUBLIC_URL:-https://devhacks-groupie-production.up.railway.app}/health" >/dev/null
B64="$(base64 < scripts/inspect/feed.cjs | tr -d '\n')"
railway ssh -- "echo $B64 | base64 -d > /tmp/inspect-feed.cjs && NODE_PATH=/app/apps/server/node_modules node /tmp/inspect-feed.cjs \${DATABASE_PATH:-/data/groupie.db} $USER_ID; rm -f /tmp/inspect-feed.cjs" 2>/dev/null
