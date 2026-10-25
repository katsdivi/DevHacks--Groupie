#!/usr/bin/env bash
# Copies the production SQLite DB off the Railway volume using SQLite's online backup API,
# then checks it locally. Usage: scripts/backup-db.sh [label]
set -euo pipefail
cd "$(dirname "$0")/.."
URL="${PUBLIC_URL:-https://devhacks-groupie-production.up.railway.app}"
LABEL="${1:-backup}"
OUT="backups/${LABEL}-$(date +%Y%m%d-%H%M).db"
mkdir -p backups

# The service sleeps when idle; wake it so SSH works.
curl -sf -m 60 "$URL/health" >/dev/null
sleep 3

RAW="$(mktemp)"
trap 'rm -f "$RAW"' EXIT
railway ssh -- "cd /app/apps/server && node -e \"const D=require('better-sqlite3');const fs=require('fs');const db=new D(process.env.DATABASE_PATH||'/data/groupie.db',{readonly:true});db.backup('/tmp/groupie-backup.db').then(()=>{process.stdout.write('B64START'+fs.readFileSync('/tmp/groupie-backup.db').toString('base64')+'B64END');fs.unlinkSync('/tmp/groupie-backup.db')})\"" 2>/dev/null >"$RAW"

python3 - "$RAW" "$OUT" <<'PY'
import base64, re, sys
data = open(sys.argv[1]).read()
m = re.search(r'B64START(.*)B64END', data, re.S)
if not m:
    sys.exit('backup failed: no data from railway ssh')
open(sys.argv[2], 'wb').write(base64.b64decode(m.group(1)))
PY

node -e "
const D = require('./apps/server/node_modules/better-sqlite3');
const d = new D(process.argv[1], { readonly: true });
const ok = d.pragma('integrity_check', { simple: true });
if (ok !== 'ok') { console.error('integrity_check failed:', ok); process.exit(1); }
const counts = ['groups', 'members', 'tasks', 'availability', 'meetings', 'agent_messages']
  .map((t) => t + '=' + d.prepare('select count(*) c from ' + t).get().c).join(' ');
console.log('verified', process.argv[1], 'bytes=' + require('fs').statSync(process.argv[1]).size, 'user_version=' + d.pragma('user_version', { simple: true }), counts);
" "$OUT"
