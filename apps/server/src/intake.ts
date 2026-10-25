import type { ParsedAssignment } from '@groupie/shared';
import { bot } from './bot/core.ts';
import { html } from './bot/format.ts';
import { taskListText } from './bot/assignment.ts';
import { postJoinStatus } from './bot/joinStatus.ts';
import { countMembers, getGroup, saveAssignment } from './groups.ts';
import { db, schema } from './db/index.ts';
import { parseAssignment } from './parse.ts';
import { eq } from 'drizzle-orm';
import type { Group } from './db/schema.ts';

/** One assignment's worth of text, from any source (Telegram file, Cubbie import). */
export type IngestInput = {
  text: string;
  /** Shown in "Reading <label>...". */
  sourceLabel: string;
  /** Extra context for the LLM (for example a Canvas rubric), appended after the document. */
  extraContext?: string;
  /** Authoritative due date (for example from Canvas), ISO. Overrides what the LLM found. */
  dueDate?: string | null;
  /** Canvas course name, saved on the group so calendar items can be scoped to it. */
  courseName?: string;
  /** Edit this existing group message instead of posting a new "Reading..." message. */
  statusMessageId?: number;
};

export type IngestResult =
  | { ok: true; parsed: ParsedAssignment }
  | { ok: false; reason: 'no_group' | 'no_team_size' | 'not_expecting' | 'busy' | 'too_short' | 'failed'; message: string };

const inFlight = new Set<number>();

/** True while Groupie is waiting for the assignment (so later shared drafts are ignored). */
export const expectingAssignment = (g: Group | undefined) =>
  !!g && (g.status === 'setup' || (g.status === 'collecting_members' && countMembers(g.id) === 0));

/**
 * Text in, tasks out: parses the assignment, saves the tasks, and posts the task list and the join
 * message in the group. Every intake path ends here so they all behave the same.
 */
export async function ingestAssignment(groupId: number, input: IngestInput): Promise<IngestResult> {
  const group = getGroup(groupId);
  if (!group) return { ok: false, reason: 'no_group', message: "I'm not in that group yet." };
  if (!group.teamSize) {
    return { ok: false, reason: 'no_team_size', message: 'Set the team size first: send /setup in the group.' };
  }
  if (!expectingAssignment(group)) {
    return { ok: false, reason: 'not_expecting', message: 'This group already has its assignment. Use /reset to start over.' };
  }
  if (inFlight.has(groupId)) return { ok: false, reason: 'busy', message: 'Still reading the last one.' };

  inFlight.add(groupId);
  const statusId =
    input.statusMessageId ??
    (await bot.api.sendMessage(groupId, `Reading <b>${html(input.sourceLabel)}</b>. Give me a sec...`, { parse_mode: 'HTML' }))
      .message_id;
  const edit = (text: string) => bot.api.editMessageText(groupId, statusId, text, { parse_mode: 'HTML' }).catch(() => {});
  const typing = setInterval(() => bot.api.sendChatAction(groupId, 'typing').catch(() => {}), 4500);
  try {
    if (input.text.replace(/\s/g, '').length < 50) {
      await edit("Hmm, I couldn't find enough text in that to work with. Can you send the assignment as a PDF or .docx?");
      return { ok: false, reason: 'too_short', message: 'Not enough assignment text.' };
    }
    await bot.api.sendChatAction(groupId, 'typing').catch(() => {});
    let parsed = await parseAssignment(input.text, group.teamSize, () => void edit('Thinking, one sec...'), input.extraContext);
    if (input.dueDate !== undefined) parsed = { ...parsed, due_date: input.dueDate ? input.dueDate.slice(0, 10) : parsed.due_date };
    saveAssignment(groupId, parsed);
    if (input.courseName) {
      db.update(schema.groups).set({ canvasCourse: input.courseName }).where(eq(schema.groups.id, groupId)).run();
    }
    if (group.statusMessageId) await bot.api.editMessageReplyMarkup(groupId, group.statusMessageId).catch(() => {});
    await edit(taskListText(group.nickname, parsed, group.tz));
    await postJoinStatus(groupId);
    return { ok: true, parsed };
  } catch (err) {
    console.error('Assignment parse failed', err);
    await edit("I couldn't make sense of that one. Try sending it again, or as a PDF?");
    return { ok: false, reason: 'failed', message: 'Could not parse the assignment.' };
  } finally {
    clearInterval(typing);
    inFlight.delete(groupId);
  }
}
