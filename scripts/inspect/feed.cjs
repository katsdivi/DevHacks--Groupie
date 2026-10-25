// Read-only stats for one user's Canvas calendar items. Never touches calendar_feeds (the URL).
// Usage: node feed.cjs <db-path> <telegram_user_id> [tz]
const Database = require('better-sqlite3');
const [dbPath, userArg, tzArg] = process.argv.slice(2);
const tz = tzArg || 'America/Phoenix';
const user = Number(userArg);
if (!Number.isInteger(user)) {
  console.error('Usage: feed.cjs <db-path> <telegram_user_id> [tz]');
  process.exit(2);
}
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const rows = db
  .prepare('SELECT course, title, due_at, kind, removed_at FROM calendar_events WHERE telegram_user_id = ? ORDER BY due_at')
  .all(user);
const live = rows.filter((r) => !r.removed_at);
const local = (iso) => {
  const d = new Date(iso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { label: `${parts.weekday} ${parts.month} ${parts.day} ${parts.hour}:${parts.minute}`, midnight: parts.hour === '00' && parts.minute === '00' };
};
const byCourse = {};
for (const r of live) byCourse[r.course ?? '(no course)'] = (byCourse[r.course ?? '(no course)'] ?? 0) + 1;
console.log(`user ${user}: ${live.length} items (${rows.length - live.length} removed from the feed)`);
console.log(`by kind: assignments ${live.filter((r) => r.kind === 'assignment').length}, events ${live.filter((r) => r.kind === 'event').length}`);
console.log('by course:');
for (const [c, k] of Object.entries(byCourse).sort((a, b) => b[1] - a[1])) console.log(`  ${k}  ${c}`);
console.log(`all-day (due exactly at 00:00 ${tz}): ${live.filter((r) => local(r.due_at).midnight).length}`);
console.log('undated: not stored (the parser skips items with no date)');
if (live.length) console.log(`earliest due: ${local(live[0].due_at).label} | latest due: ${local(live[live.length - 1].due_at).label} (${tz})`);
const now = new Date().toISOString();
const sample = [...live.filter((r) => r.due_at >= now), ...live.filter((r) => r.due_at < now)].slice(0, 5);
console.log('sample (next 5, then earlier):');
for (const r of sample) console.log(`  ${local(r.due_at).label}  ${r.title}`);
