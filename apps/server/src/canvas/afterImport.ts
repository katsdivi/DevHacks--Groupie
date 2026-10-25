import { InputFile } from 'grammy';
import { eq } from 'drizzle-orm';
import { bot } from '../bot/core.ts';
import { db, schema } from '../db/index.ts';
import { setAssignmentFile } from './assignmentSource.ts';

/** Caption on an assignment file Cubbie sent as bytes. */
export const FROM_CANVAS_CAPTION = "Here's the assignment from Canvas.";
/** Cubbie sent the file's text only (today's case), so there is no file to share yet. */
export const TEXT_ONLY_LINE = 'Got the text from Canvas. Drop the PDF here so everyone has the file.';
/** One attachment was over its size cap and was left out of the import. */
export const DROPPED_ONE_LINE = 'One file was too big to bring over. Drop it here if you have it.';
/** More than one attachment was over its cap. */
export const DROPPED_MANY_LINE = 'Some files were too big to bring over. Drop them here if you have them.';
/** Bot API upload limit for sendDocument. */
export const TELEGRAM_UPLOAD_LIMIT = 50 * 1024 * 1024;
export const tooBigForTelegram = (name: string) => `${name} is too big for Telegram. Drop it here if you have it.`;

/** A file that came with the import as bytes. */
export type ImportFile = { filename: string; mimeType?: string; bytes: Buffer };

/** Remembers which import gave the group its assignment, so a dropped PDF can attach to it later. */
export function recordCanvasImport(groupId: number, importId: number) {
  db.update(schema.groups)
    .set({ canvasImportId: importId, canvasFileAt: null, assignmentFileId: null, assignmentFileName: null, assignmentFileMime: null })
    .where(eq(schema.groups.id, groupId))
    .run();
}

/**
 * After the task list is up: posts any files that came as bytes, or the one text-only line, then a line
 * for files that were too big to bring over. Never throws.
 */
export async function postImportFiles(groupId: number, files: ImportFile[], droppedCount: number): Promise<void> {
  const send = (text: string) => bot.api.sendMessage(groupId, text).catch((err: unknown) => console.error('[import] group line failed', err));
  let saved = false;
  for (const f of files) {
    if (f.bytes.length > TELEGRAM_UPLOAD_LIMIT) {
      await send(tooBigForTelegram(f.filename));
      continue;
    }
    try {
      const msg = await bot.api.sendDocument(groupId, new InputFile(f.bytes, f.filename), { caption: FROM_CANVAS_CAPTION });
      // The first file that posts is the assignment's file, for a later re-send.
      const doc = msg?.document;
      if (doc && !saved) {
        setAssignmentFile(groupId, { fileId: doc.file_id, fileName: doc.file_name ?? f.filename, mimeType: doc.mime_type ?? f.mimeType });
        saved = true;
      }
    } catch (err) {
      console.error('[import] sendDocument failed', err);
    }
  }
  if (!files.length) await send(TEXT_ONLY_LINE);
  if (droppedCount) await send(droppedCount === 1 ? DROPPED_ONE_LINE : DROPPED_MANY_LINE);
}
