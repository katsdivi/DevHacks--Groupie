import { eq } from 'drizzle-orm';
import type { CubbieImportPayload } from '@groupie/shared';
import { db, schema } from '../db/index.ts';

/** Where the group's current assignment came from, so it can be re-sent later. */
export type AssignmentSource = { fileId?: string; fileName?: string; mimeType?: string; canvasText?: string; title?: string };

/** Saves the Telegram file behind the group's current assignment (dropped in, or posted after a Cubbie import). */
export function setAssignmentFile(groupId: number, file: { fileId: string; fileName?: string | null; mimeType?: string | null }) {
  db.update(schema.groups)
    .set({ assignmentFileId: file.fileId, assignmentFileName: file.fileName ?? null, assignmentFileMime: file.mimeType ?? null })
    .where(eq(schema.groups.id, groupId))
    .run();
}

/** The Canvas description and attachment texts of one stored import payload, joined. */
export function canvasTextOf(payload: CubbieImportPayload): string {
  const pieces = [payload.assignment?.descriptionText ?? '', ...(payload.attachments ?? []).map((a) => a.text ?? '')];
  return pieces.filter((t) => t.trim()).join('\n\n');
}

/**
 * The group's current assignment: its Telegram file (if one reached the group), the Canvas text (if it came
 * from a Cubbie import), and the title. Reads only this group's rows. Empty after /reset (the group row goes).
 */
export function assignmentSource(groupId: number): AssignmentSource {
  const g = db.select().from(schema.groups).where(eq(schema.groups.id, groupId)).get();
  if (!g) return {};
  const out: AssignmentSource = {};
  if (g.assignmentTitle) out.title = g.assignmentTitle;
  if (g.assignmentFileId) {
    out.fileId = g.assignmentFileId;
    if (g.assignmentFileName) out.fileName = g.assignmentFileName;
    if (g.assignmentFileMime) out.mimeType = g.assignmentFileMime;
  }
  if (g.canvasImportId) {
    const row = db.select().from(schema.cubbieImports).where(eq(schema.cubbieImports.id, g.canvasImportId)).get();
    if (row && row.groupChatId === groupId && row.status === 'imported') {
      const text = canvasTextOf(row.payload as CubbieImportPayload);
      if (text) out.canvasText = text;
    }
  }
  return out;
}
