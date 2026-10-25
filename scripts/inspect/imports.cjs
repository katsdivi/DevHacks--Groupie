// Read-only summary of recent Cubbie imports. Never prints description text or attachment content.
// Usage: node imports.cjs <db-path> [N]
const Database = require('better-sqlite3');
const [dbPath, nArg] = process.argv.slice(2);
const n = Math.max(1, Math.min(50, Number(nArg) || 5));
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const rows = db
  .prepare('SELECT id, created_at, status, error, group_chat_id, payload FROM cubbie_imports ORDER BY id DESC LIMIT ?')
  .all(n);
if (!rows.length) console.log('No Cubbie imports yet.');
for (const r of rows) {
  let p = {};
  try { p = JSON.parse(r.payload); } catch { /* keep empty */ }
  const a = p.assignment ?? {};
  const criteria = p.rubric?.criteria ?? [];
  const atts = (p.attachments ?? []).map((x) => {
    if (x.base64Length != null) return `bytes ${Math.floor((x.base64Length * 3) / 4)}B ${x.mimeType ?? ''}`.trim();
    if (x.text != null) return `text ${x.text.length} chars ${x.mimeType ?? ''}`.trim();
    if (x.url != null) return 'url';
    return 'unknown';
  });
  console.log(
    [
      `#${r.id} ${r.created_at} status=${r.status}${r.error ? ` error="${r.error}"` : ''}`,
      `  group=${r.group_chat_id ?? 'none'} course="${p.course?.name ?? ''}" title="${a.title ?? ''}"`,
      `  due=${a.dueAt ? `yes (${a.dueAt})` : 'no'} points=${a.pointsPossible ?? 'none'} description=${(a.descriptionText ?? '').length} chars`,
      `  rubric=${criteria.length ? `yes, ${criteria.length} criteria (${criteria.reduce((s, c) => s + (c.points || 0), 0)} pts)` : 'no'}`,
      `  attachments=${atts.length}${atts.length ? `: ${atts.join('; ')}` : ''}`,
    ].join('\n'),
  );
}
