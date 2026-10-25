import { InputFile } from 'grammy';
import { desc, eq, inArray, isNotNull, and } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db, schema } from '../db/index.ts';
import { getGroup } from '../groups.ts';
import { assignmentSource } from '../canvas/assignmentSource.ts';
import { renderPdf } from '../cards/render.ts';
import { bot } from './core.ts';
import { html } from './format.ts';
import { CANVAS_PDF_CAPTION, FILE_SEND_FAILED, fileCaption, NO_ASSIGNMENT_FILE, TEXT_PDF_CAPTION } from '../copy.ts';

/**
 * "Send me the assignment": re-sends the group's assignment file (the original Telegram file when one
 * reached the group), else a PDF made from the assignment text Groupie read (Canvas text included).
 * Nothing is ever fetched from Canvas here. Only the asker's own groups are used.
 */

const THING = '(?:assignment|pdf|file|doc|docx|document|instructions|handout|spec|template|brief|prompt)';
const THE = '(?:the|a copy of(?: the)?|that|this|our)';
const ASKS = [
  new RegExp(`\\b(?:send|give|share|post|forward|resend|re-send|attach|drop|dm)\\s+(?:me|us|everyone|it|over)?\\s*${THE}?\\s*(?:original\\s+|assignment\\s+|canvas\\s+)?${THING}\\b`, 'i'),
  // "get" only with a recipient, so "did you get the assignment?" stays a question.
  new RegExp(`\\b(?:get|grab)\\s+(?:me|us)\\s+${THE}?\\s*(?:original\\s+|assignment\\s+|canvas\\s+)?${THING}\\b`, 'i'),
  new RegExp(`\\b(?:i|we)\\s+(?:need|want|would like)\\s+${THE}\\s+(?:original\\s+|assignment\\s+)?${THING}\\b`, 'i'),
  new RegExp(`\\bcan\\s+(?:i|we)\\s+(?:have|get|see|download)\\s+${THE}\\s+(?:original\\s+|assignment\\s+)?${THING}\\b`, 'i'),
  new RegExp(`\\bwhere(?:'?s|\\s+is|\\s+can\\s+i\\s+find)\\s+the\\s+(?:assignment\\s+)?(?:pdf|file|doc|document|handout|instructions|template)\\b`, 'i'),
  new RegExp(`^\\s*(?:the\\s+)?(?:assignment\\s+)?(?:pdf|file|doc|document|handout)\\s*(?:please|pls)?\\s*[?.!]*\\s*$`, 'i'),
];

/** True when the text asks for the assignment itself (the file), not a question about it. Pure. */
export const wantsAssignmentFile = (text: string) => ASKS.some((r) => r.test(text));

/** The asker's groups that have an assignment, newest assignment first. */
export function groupsWithAssignment(telegramUserId: number): number[] {
  const ids = db
    .select({ groupId: schema.members.groupId })
    .from(schema.members)
    .where(eq(schema.members.tgUserId, telegramUserId))
    .all()
    .map((r) => r.groupId);
  if (!ids.length) return [];
  // Task ids grow with each assignment, so the highest id marks the newest assignment.
  const latest = new Map<number, number>();
  for (const t of db
    .select({ groupId: schema.tasks.groupId, id: schema.tasks.id })
    .from(schema.tasks)
    .where(inArray(schema.tasks.groupId, ids))
    .orderBy(desc(schema.tasks.id))
    .all()) {
    if (!latest.has(t.groupId)) latest.set(t.groupId, t.id);
  }
  const withTitle = new Set(
    db
      .select({ id: schema.groups.id })
      .from(schema.groups)
      .where(and(inArray(schema.groups.id, ids), isNotNull(schema.groups.assignmentTitle)))
      .all()
      .map((g) => g.id),
  );
  return ids.filter((id) => withTitle.has(id)).sort((a, b) => (latest.get(b) ?? 0) - (latest.get(a) ?? 0));
}

const slug = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'assignment';

/** A plain, readable page for the assignment text. */
export function assignmentPdfHtml(title: string, sub: string, text: string): string {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => `<p>${html(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;font-size:11.5pt;line-height:1.5}
h1{font-size:20pt;margin:0 0 4pt}.sub{color:#666;margin:0 0 18pt;font-size:10pt}p{margin:0 0 9pt;white-space:normal}
</style></head><body><h1>${html(title)}</h1><div class="sub">${html(sub)}</div>${paras}</body></html>`;
}

export type SendResult = 'file' | 'pdf' | 'none' | 'failed';

/** Sends the group's assignment to `chatId` (the group itself or the asker's DM). */
export async function sendAssignment(chatId: number, groupId: number, replyTo?: number): Promise<SendResult> {
  const group = getGroup(groupId);
  const src = assignmentSource(groupId);
  const reply = replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {};
  if (!group?.assignmentTitle) {
    await bot.api.sendMessage(chatId, NO_ASSIGNMENT_FILE, reply).catch(() => {});
    return 'none';
  }
  const title = group.assignmentTitle;
  await bot.api.sendChatAction(chatId, 'upload_document').catch(() => {});
  if (src.fileId) {
    const sent = await bot.api.sendDocument(chatId, src.fileId, { caption: fileCaption(title), ...reply }).then(
      () => true,
      (err) => (console.error('Assignment re-send failed', err), false),
    );
    if (sent) return 'file';
  }
  const text = group.assignmentText ?? src.canvasText;
  if (!text) {
    await bot.api.sendMessage(chatId, NO_ASSIGNMENT_FILE, reply).catch(() => {});
    return 'none';
  }
  const fromCanvas = !!src.canvasText && !src.fileId;
  const due = group.dueDate ? `Due ${DateTime.fromISO(group.dueDate.slice(0, 10), { zone: group.tz }).toFormat('ccc, LLL d')}` : '';
  const sub = [group.canvasCourse, due, fromCanvas ? 'Text from Canvas' : ''].filter(Boolean).join(' · ');
  try {
    const pdf = await renderPdf(assignmentPdfHtml(title, sub, text));
    await bot.api.sendDocument(chatId, new InputFile(pdf, `${slug(title)}.pdf`), { caption: fromCanvas ? CANVAS_PDF_CAPTION : TEXT_PDF_CAPTION, ...reply });
    return 'pdf';
  } catch (err) {
    console.error('Assignment PDF failed', err);
    await bot.api.sendMessage(chatId, FILE_SEND_FAILED, reply).catch(() => {});
    return 'failed';
  }
}
