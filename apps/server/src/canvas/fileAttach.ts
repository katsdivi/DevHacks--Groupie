import { eq } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import type { CubbieImportPayload, ParsedAssignment } from '@groupie/shared';
import { bot } from '../bot/core.ts';
import { html } from '../bot/format.ts';
import { postSplitCard } from '../bot/split.ts';
import { db, schema } from '../db/index.ts';
import { getGroup, saveAssignment, type Group } from '../groups.ts';
import { formatRubricContext, parseAssignment } from '../parse.ts';
import { applySplit, computeSplit } from '../splitService.ts';

/** A file dropped after a text-only Canvas import, attached to that assignment. */
export const FILE_ATTACHED = 'Got the file, everyone can grab it here.';
export const ASK_UPDATE = 'Update the tasks from this file?';
export const UPDATE_BUTTON = 'Update';
export const KEEP_BUTTON = 'Keep current';
export const KEPT_TEXT = 'Keeping the current tasks.';
export const UPDATING_TEXT = 'Updating the tasks from the file...';
export const UPDATED_TEXT = 'Updated the tasks from the file.';
export const UPDATE_FAILED_TEXT = "I couldn't make tasks from that file, so the current ones stay.";
export const PROMPT_GONE_TEXT = 'That question expired. The current tasks stay.';
export const UPDATE_DATA = 'cfile:update';
export const KEEP_DATA = 'cfile:keep';
/** Team size for the re-parse when the group has none yet. */
const FALLBACK_TEAM_SIZE = 4;

/**
 * Similarity rule: below this token Jaccard score against every piece of the imported text, the file
 * "clearly differs" and we offer to update the tasks.
 */
export const SIMILARITY_THRESHOLD = 0.5;

/** Lowercased word tokens of 3+ letters or digits. */
export function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3));
}

/** |A and B| / |A or B| over token sets. Two empty texts count as the same. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let both = 0;
  for (const t of a) if (b.has(t)) both++;
  return both / (a.size + b.size - both);
}

/**
 * Best Jaccard score of the file against the imported text. Compared against each piece (the
 * description, each attachment text) and all of it together, so a PDF of just the spec still matches.
 */
export function similarityToImport(fileText: string, pieces: string[]): number {
  const file = tokens(fileText);
  const candidates = [...pieces, pieces.join('\n')].filter((p) => p.trim());
  if (!candidates.length) return 0;
  return Math.max(...candidates.map((c) => jaccard(file, tokens(c))));
}

/** The stored payload's text pieces: the description and each attachment's text. */
export function importedPieces(payload: CubbieImportPayload): string[] {
  return [payload.assignment?.descriptionText ?? '', ...(payload.attachments ?? []).map((a) => a.text ?? '')].filter((t) => t.trim());
}

/**
 * The Canvas import a dropped file should attach to: the group got its assignment from a successful import
 * that brought text only (no file bytes), and no file was attached yet. Otherwise null.
 */
export function textOnlyCanvasImport(group: Group | undefined): { importId: number; payload: CubbieImportPayload } | null {
  if (!group?.canvasImportId || group.canvasFileAt || !group.assignmentTitle) return null;
  const row = db.select().from(schema.cubbieImports).where(eq(schema.cubbieImports.id, group.canvasImportId)).get();
  if (!row || row.status !== 'imported' || row.groupChatId !== group.id) return null;
  const payload = row.payload as CubbieImportPayload;
  const attachments = (payload.attachments ?? []) as { base64Length?: number }[];
  if (attachments.some((a) => a.base64Length)) return null;
  return { importId: row.id, payload };
}

export function markFileAttached(groupId: number, now = new Date()) {
  db.update(schema.groups).set({ canvasFileAt: now.toISOString() }).where(eq(schema.groups.id, groupId)).run();
}

/** Text waiting on [Update] / [Keep current], per group. In memory: a restart drops the question (it says so). */
const pending = new Map<number, { text: string; messageId: number }>();

export const updateKeyboard = () => new InlineKeyboard().text(UPDATE_BUTTON, UPDATE_DATA).text(KEEP_BUTTON, KEEP_DATA);

/** Asks the group whether to update the tasks from the file, and remembers the file's text. */
export async function askToUpdate(groupId: number, text: string, replyTo: number) {
  const msg = await bot.api.sendMessage(groupId, ASK_UPDATE, {
    reply_markup: updateKeyboard(),
    reply_parameters: { message_id: replyTo, allow_sending_without_reply: true },
  });
  pending.set(groupId, { text, messageId: msg.message_id });
}

/** Takes the waiting text for this question, or undefined if it is gone or a newer question replaced it. */
export function takePending(groupId: number, messageId: number | undefined): string | undefined {
  const p = pending.get(groupId);
  if (!p || (messageId != null && p.messageId !== messageId)) return undefined;
  pending.delete(groupId);
  return p.text;
}

const SPLIT_STATUSES: Group['status'][] = ['split_ready', 'scheduling', 'active'];

/**
 * [Update]: re-reads the tasks from the file (with the Canvas rubric and due date), replaces the task list,
 * posts it, and re-splits only if a split existed. The intake is not used because it refuses groups that
 * already have an assignment. Returns false (tasks untouched) when the parse fails.
 */
export async function updateTasksFromFile(
  groupId: number,
  text: string,
  listText: (nickname: string, parsed: ParsedAssignment, tz: string) => string,
): Promise<boolean> {
  const group = getGroup(groupId);
  if (!group) return false;
  const imp = importPayload(group);
  const extraContext = imp?.rubric ? formatRubricContext({ criteria: imp.rubric.criteria }) : undefined;
  let parsed;
  try {
    parsed = await parseAssignment(text, group.teamSize ?? FALLBACK_TEAM_SIZE, undefined, extraContext);
  } catch (err) {
    console.error('[import] update from dropped file failed', err);
    return false;
  }
  const dueAt = imp?.assignment?.dueAt;
  if (dueAt) parsed = { ...parsed, due_date: dueAt.slice(0, 10) };
  const hadSplit = SPLIT_STATUSES.includes(group.status);
  saveAssignment(groupId, parsed);
  // saveAssignment puts the group back to collecting_members; keep where it was.
  if (hadSplit) db.update(schema.groups).set({ status: group.status }).where(eq(schema.groups.id, groupId)).run();
  await bot.api.sendMessage(groupId, `Updated from the file.\n\n${listText(group.nickname, parsed, group.tz)}`, { parse_mode: 'HTML' });
  if (hadSplit) {
    applySplit(groupId, computeSplit(groupId));
    await postSplitCard(groupId, `<b>${html(group.nickname)} here.</b> New tasks, new split.`);
  }
  return true;
}

/** The import's stored payload (rubric, due date), even after a file was attached. */
function importPayload(group: Group): CubbieImportPayload | null {
  if (!group.canvasImportId) return null;
  const row = db.select().from(schema.cubbieImports).where(eq(schema.cubbieImports.id, group.canvasImportId)).get();
  return row ? (row.payload as CubbieImportPayload) : null;
}
