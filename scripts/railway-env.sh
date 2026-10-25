#!/usr/bin/env bash
# Copies the Canvas variables from the repo-root .env to the linked Railway service without deploying.
# Values go through stdin and are never printed; output shows names and lengths only.
#
# Usage: scripts/railway-env.sh [--dry-run] [--delete-old] [-s SERVICE] [-e ENVIRONMENT]
#   --dry-run     validate and show what would be set, without calling railway
#   --delete-old  also delete the old CUBBIE_HMAC_SECRET (run only once the renamed code is live;
#                 `railway variable delete` has no --skip-deploys, so it may trigger a redeploy)
set -euo pipefail

KEYS=(CUBBIE_PUBLIC_SIGNING_KEY FEED_ENCRYPTION_KEY LOAD_AWARE_SPLIT)
OLD_KEY=CUBBIE_HMAC_SECRET
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"

dry_run=0
delete_old=0
target=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --delete-old) delete_old=1 ;;
    -s|--service|-e|--environment)
      [[ $# -ge 2 ]] || { echo "error: $1 needs a value" >&2; exit 2; }
      target+=("$1" "$2")
      shift
      ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "error: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done

[[ -f "$ENV_FILE" ]] || { echo "error: $ENV_FILE not found" >&2; exit 1; }

# Prints the value of KEY from .env (last assignment wins). Skips comments, allows `export `,
# strips surrounding quotes, and drops an unquoted inline ` # comment`. Never sources the file.
env_value() {
  local want="$1" line key val found=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]] || continue
    key="${BASH_REMATCH[2]}"
    [[ "$key" == "$want" ]] || continue
    val="${BASH_REMATCH[3]}"
    val="${val#"${val%%[![:space:]]*}"}"
    if [[ "$val" =~ ^\"([^\"]*)\" ]]; then
      val="${BASH_REMATCH[1]}"
    elif [[ "$val" =~ ^\'([^\']*)\' ]]; then
      val="${BASH_REMATCH[1]}"
    else
      [[ "$val" == \#* ]] && val=""
      val="${val%%[[:space:]]#*}"
      val="${val%"${val##*[![:space:]]}"}"
    fi
    found="$val"
  done < "$ENV_FILE"
  printf '%s' "$found"
}

# Parallel to KEYS (macOS ships bash 3.2, which has no associative arrays).
values=()
missing=0
for i in "${!KEYS[@]}"; do
  k="${KEYS[$i]}"
  values[$i]="$(env_value "$k")"
  if [[ -z "${values[$i]}" ]]; then
    echo "error: $k is empty or missing in .env" >&2
    missing=1
  fi
done
[[ $missing -eq 0 ]] || exit 1

if [[ "${values[0]}" == "${values[1]}" ]]; then
  echo "error: CUBBIE_PUBLIC_SIGNING_KEY equals FEED_ENCRYPTION_KEY; give each its own value" >&2
  exit 1
fi

if [[ $dry_run -eq 1 ]]; then
  for i in "${!KEYS[@]}"; do echo "would set ${KEYS[$i]} (${#values[$i]} chars)"; done
  if [[ $delete_old -eq 1 ]]; then echo "would delete $OLD_KEY"; else echo "note: $OLD_KEY left as is (pass --delete-old once the renamed code is live)"; fi
  echo "dry run: railway not called"
  exit 0
fi

command -v railway >/dev/null || { echo "error: railway CLI not found" >&2; exit 1; }

for i in "${!KEYS[@]}"; do
  k="${KEYS[$i]}"
  printf '%s' "${values[$i]}" | railway variable set "$k" --stdin --skip-deploys ${target[@]+"${target[@]}"} >/dev/null
  echo "set $k (${#values[$i]} chars)"
done

if [[ $delete_old -eq 1 ]]; then
  if railway variable delete "$OLD_KEY" ${target[@]+"${target[@]}"} >/dev/null 2>&1; then
    echo "deleted $OLD_KEY"
  else
    echo "note: could not delete $OLD_KEY (maybe already gone)"
  fi
else
  echo "note: $OLD_KEY left as is (pass --delete-old once the renamed code is live)"
fi
echo "done: no deploy triggered; the next deploy picks these up"
