import { Composer, type Context } from 'grammy';
import type { ParsedAssignment } from '@groupie/shared';
import { env } from '../env.ts';
import { getGroup } from '../groups.ts';
import {
  extractDocumentText,
  fileExtension,
  isReadableFormat,
  SUPPORTED_FORMATS,
} from '../parse.ts';
import type { Group } from '../db/schema.ts';
import { formatDue, html } from './format.ts';
import { ingestAssignment, expectingAssignment } from '../intake.ts';
import { setAssignmentFile } from '../canvas/assignmentSource.ts';
import {
  askToUpdate,
  FILE_ATTACHED,
  KEEP_DATA,
  KEPT_TEXT,
  markFileAttached,
  importedPieces,
  PROMPT_GONE_TEXT,
  SIMILARITY_THRESHOLD,
  similarityToImport,
  takePending,
  textOnlyCanvasImport,
  UPDATE_DATA,
  UPDATE_FAILED_TEXT,
  UPDATED_TEXT,
  UPDATING_TEXT,
  updateTasksFromFile,
} from '../canvas/fileAttach.ts';

export const assignment = new Composer();

const MAX_BYTES = 20 * 1024 * 1024; // Bot API download limit

export function taskListText(nickname: string, parsed: ParsedAssignment, tz: string): string {
  const points = parsed.tasks.reduce((s, t) => s + t.effort, 0);
  const due = formatDue(parsed.due_date, tz);
  const lines = parsed.tasks.map((t) => `<code>${String(t.effort).padStart(2, ' ')} pt</code>  ${html(t.title)}`);
  return [
    `<b>Got it: ${html(parsed.assignment_title)}</b>`,
    [due && `Due ${due}`, `${parsed.tasks.length} tasks`, `${points} points`].filter(Boolean).join(' · '),
    '',
    ...lines,
    '',
    `${html(nickname)} here. Next, everyone adds their details and I split this so nobody carries the team.`,
  ].join('\n');
}

async function download(ctx: Context, fileId: string): Promise<Uint8Array> {
  const file = await ctx.api.getFile(fileId);
  const res = await fetch(`https://api.telegram.org/file/bot${env.botToken}/${file.file_path}`);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

const isGroup = (ctx: Context) => ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';


assignment.on('message:photo', async (ctx, next) => {
  if (!isGroup(ctx) || !expectingAssignment(getGroup(ctx.chat.id))) return next();
  await ctx.reply(`I can't read photos yet. Send the assignment as a file instead: ${SUPPORTED_FORMATS}.`, {
    reply_parameters: { message_id: ctx.msg.message_id },
  });
});

assignment.on('message:document', async (ctx, next) => {
  const doc = ctx.msg.document;
  const group = getGroup(ctx.chat.id);
  const ext = fileExtension(doc.file_name, doc.mime_type);
  // After a text-only Canvas import, the first readable file joins that assignment instead of starting over.
  if (isGroup(ctx) && group?.canvasImportId && group.assignmentTitle) {
    const canvas = isReadableFormat(ext) ? textOnlyCanvasImport(group) : null;
    if (canvas) {
      setAssignmentFile(group.id, { fileId: doc.file_id, fileName: doc.file_name, mimeType: doc.mime_type });
      return attachToCanvasImport(ctx, group.id, doc.file_id, ext, doc.file_size ?? 0, importedPieces(canvas.payload));
    }
    // The assignment already came from Canvas: a later file never starts a second task list.
    return next();
  }
  if (!isGroup(ctx) || !expectingAssignment(group)) return next();
  const reply = (text: string) =>
    ctx.reply(text, { parse_mode: 'HTML', reply_parameters: { message_id: ctx.msg.message_id } });

  if (!isReadableFormat(ext)) {
    const legacy = ['doc', 'ppt', 'xls', 'pages', 'key'].includes(ext);
    await reply(
      legacy
        ? `That's an older .${ext} file I can't open. Save it as PDF or .docx and send it again?`
        : `I can't read ${ext ? `.${html(ext)}` : 'that kind of'} files. Send the assignment as ${SUPPORTED_FORMATS}.`,
    );
    return;
  }
  if (!group!.teamSize) {
    await reply("Ooh, homework. Tell me the team size first: send /setup, pick a number, then drop the file again.");
    return;
  }
  const ok = await readAssignment(ctx, group!, doc.file_id, doc.file_name ?? 'the assignment', ext, doc.file_size ?? 0);
  // The dropped file became the assignment: keep it for a later re-send.
  if (ok) setAssignmentFile(group!.id, { fileId: doc.file_id, fileName: doc.file_name, mimeType: doc.mime_type });
});

/** Reads a dropped file into the assignment. True when the task list landed. */
async function readAssignment(ctx: Context, group: Group, fileId: string, fileName: string, ext: string, size: number): Promise<boolean> {
  const reply = (text: string) =>
    ctx.reply(text, { parse_mode: 'HTML', reply_parameters: { message_id: ctx.msg!.message_id } });
  if (size > MAX_BYTES) {
    await reply('That file is too big for me (20 MB max). Can you send a smaller one?');
    return false;
  }
  const status = await reply(`Reading <b>${html(fileName)}</b>. Give me a sec...`);
  let text: string;
  try {
    await ctx.replyWithChatAction('typing').catch(() => {});
    text = await extractDocumentText(await download(ctx, fileId), ext);
  } catch (err) {
    console.error('Assignment download or extract failed', err);
    await ctx.api.editMessageText(ctx.chat!.id, status.message_id, "I couldn't open that file. Try sending it again, or as a PDF?").catch(() => {});
    return false;
  }
  if (ext === 'pdf' && text.replace(/\s/g, '').length < 50) {
    await ctx.api
      .editMessageText(ctx.chat!.id, status.message_id, "Hmm, that PDF looks like a scan, so I can't read the text. Can you send one with selectable text?")
      .catch(() => {});
    return false;
  }
  const result = await ingestAssignment(group.id, { text, sourceLabel: fileName, statusMessageId: status.message_id });
  if (!result.ok && result.reason === 'busy') {
    await ctx.api.editMessageText(ctx.chat!.id, status.message_id, 'Still reading the last one. Give me a sec!').catch(() => {});
  }
  return result.ok;
}

/**
 * Attaches a dropped file to the text-only Canvas import: the file stays in the chat for everyone, and the
 * group is asked to update the tasks only when the file's text clearly differs from what Canvas sent.
 * Never fetches anything from Canvas.
 */
async function attachToCanvasImport(ctx: Context, groupId: number, fileId: string, ext: string, size: number, pieces: string[]) {
  const messageId = ctx.msg!.message_id;
  markFileAttached(groupId);
  await ctx.reply(FILE_ATTACHED, { reply_parameters: { message_id: messageId } });
  if (size > MAX_BYTES) return;
  let text: string;
  try {
    text = await extractDocumentText(await download(ctx, fileId), ext);
  } catch (err) {
    console.error('Dropped file download or extract failed', err);
    return;
  }
  // A scan or near-empty file has nothing to compare.
  if (text.replace(/\s/g, '').length < 50) return;
  if (similarityToImport(text, pieces) >= SIMILARITY_THRESHOLD) return;
  await askToUpdate(groupId, text, messageId);
}

assignment.callbackQuery(UPDATE_DATA, async (ctx) => {
  const groupId = ctx.chat!.id;
  const text = takePending(groupId, ctx.callbackQuery.message?.message_id);
  if (!text) {
    await ctx.answerCallbackQuery({ text: PROMPT_GONE_TEXT });
    await ctx.editMessageReplyMarkup().catch(() => {});
    return;
  }
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(UPDATING_TEXT).catch(() => {});
  const ok = await updateTasksFromFile(groupId, text, taskListText);
  await ctx.editMessageText(ok ? UPDATED_TEXT : UPDATE_FAILED_TEXT).catch(() => {});
});

assignment.callbackQuery(KEEP_DATA, async (ctx) => {
  takePending(ctx.chat!.id, ctx.callbackQuery.message?.message_id);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(KEPT_TEXT).catch(() => {});
});
