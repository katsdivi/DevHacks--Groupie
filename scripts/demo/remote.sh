#!/usr/bin/env bash
# Runs the demo CLI inside the Railway container (code is already at /app). Prints the plan and needs --yes.
# Usage: scripts/demo/remote.sh <reset|seed|fill|remind|warm> <id> --as <adminId> [--leave-join] [--before-import] [--reparse] --yes
# The gitignored demo.config.json is not in the image, so its contents travel as DEMO_CONFIG_JSON (base64).
set -euo pipefail
cd "$(dirname "$0")/../.."
URL="${PUBLIC_URL:-https://devhacks-groupie-production.up.railway.app}"

YES=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --yes) YES=1 ;;
    --prod-ok) ;; # always added below
    *)
      [[ "$a" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "refusing argument with unsafe characters: $a"; exit 2; }
      ARGS+=("$a")
      ;;
  esac
done
[[ ${#ARGS[@]} -ge 2 ]] || { echo "usage: scripts/demo/remote.sh <reset|seed|fill|remind|warm> <id> --as <adminId> [--leave-join] [--before-import] [--reparse] --yes"; exit 2; }
case "${ARGS[0]}" in reset|seed|fill|remind|warm) ;; *) echo "unknown subcommand ${ARGS[0]}"; exit 2 ;; esac

CONFIG_ENV=""
CONFIG_NOTE="none (admins must be in DEMO_ADMIN_IDS on Railway)"
if [[ -f demo.config.json ]]; then
  CONFIG_ENV="DEMO_CONFIG_JSON=$(base64 < demo.config.json | tr -d '\n') "
  CONFIG_NOTE="demo.config.json (sent as DEMO_CONFIG_JSON)"
fi
REMOTE="cd /app && ${CONFIG_ENV}pnpm --filter @groupie/server exec tsx src/demo/cli.ts ${ARGS[*]} --prod-ok"

echo "About to run against PRODUCTION (Railway, DATABASE_PATH=/data/groupie.db):"
echo "  cli.ts ${ARGS[*]} --prod-ok"
echo "  config: $CONFIG_NOTE"
case "${ARGS[0]}" in
  reset) echo "  effect: wipes group ${ARGS[1]} back to setup (keeps the group row)" ;;
  seed) echo "  effect: resets group ${ARGS[1]}, then loads the demo team, tasks, calendar, and Canvas items" ;;
  remind) echo "  effect: sends a real reminder DM to ${ARGS[1]} now" ;;
  warm) echo "  effect: runs the demo prompts for group ${ARGS[1]} (LLM calls, Telegram stubbed) to fill /data/llm-cache.json" ;;
esac
if [[ $YES -ne 1 ]]; then
  echo "Dry run. Add --yes to run it."
  exit 1
fi

curl -sf -m 60 "$URL/health" >/dev/null
railway ssh -- "$REMOTE"
