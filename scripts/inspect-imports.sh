#!/usr/bin/env bash
# Latest Cubbie imports from production, read-only. Usage: scripts/inspect-imports.sh [N] | --local <db> [N]
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" == "--local" ]]; then
  NODE_PATH=apps/server/node_modules node scripts/inspect/imports.cjs "$2" "${3:-5}"
  exit
fi
N="${1:-5}"
[[ "$N" =~ ^[0-9]+$ ]] || { echo "N must be a number"; exit 2; }
curl -sf -m 60 "${PUBLIC_URL:-https://devhacks-groupie-production.up.railway.app}/health" >/dev/null
B64="$(base64 < scripts/inspect/imports.cjs | tr -d '\n')"
railway ssh -- "echo $B64 | base64 -d > /tmp/inspect-imports.cjs && NODE_PATH=/app/apps/server/node_modules node /tmp/inspect-imports.cjs \${DATABASE_PATH:-/data/groupie.db} $N; rm -f /tmp/inspect-imports.cjs" 2>/dev/null
