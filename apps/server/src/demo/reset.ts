import { eq, inArray, like, or } from 'drizzle-orm';
import { db, schema } from '../db/index.ts';

/**
 * Wipes one group's state back to a clean start but keeps the group row (bot membership, title,
 * nickname, tz). Never touches other groups, or user-level data not tied to this group (calendar
 * feeds and connections, real Canvas items, user prefs, busy blocks, DM history).
 */

const {
  groups,
  members,
  tasks,
  availability,
  agentMessages,
  userMemory,
  splitVotes,
  swapRequests,
  meetings,
  cubbiePairCodes,
  cubbieImports,
  pendingInputs,
  calendarEvents,
  remindersSent,
} = schema;

/** Every Canvas item the demo seeds for this group has a uid starting with this. */
export const demoUidPrefix = (groupId: number) => `groupie-demo:${groupId}:`;

export type ResetSummary = Record<string, number> & { found: number };

/** Clears the group. Returns how many rows each table lost (found=0 when there is no such group). */
export function resetGroup(groupId: number): ResetSummary {
  return db.transaction((tx) => {
    const group = tx.select().from(groups).where(eq(groups.id, groupId)).get();
    if (!group) return { found: 0 };
    const memberIds = tx.select({ id: members.id }).from(members).where(eq(members.groupId, groupId)).all().map((m) => m.id);
    const taskIds = tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.groupId, groupId)).all().map((t) => t.id);
    const n = (r: { changes: number }) => r.changes;
    const prefix = demoUidPrefix(groupId);

    const reminderKeys = [`assign:${groupId}`, ...taskIds.map((id) => `task:${id}`)];
    const out: ResetSummary = { found: 1 };
    out.remindersSent = n(
      tx
        .delete(remindersSent)
        .where(or(inArray(remindersSent.itemKey, reminderKeys), like(remindersSent.itemKey, `cal:${prefix}%`)))
        .run(),
    );
    out.calendarEvents = n(tx.delete(calendarEvents).where(like(calendarEvents.uid, `${prefix}%`)).run());
    out.swapRequests = n(tx.delete(swapRequests).where(eq(swapRequests.groupId, groupId)).run());
    out.splitVotes = n(tx.delete(splitVotes).where(eq(splitVotes.groupId, groupId)).run());
    out.meetings = n(tx.delete(meetings).where(eq(meetings.groupId, groupId)).run());
    out.tasks = n(tx.delete(tasks).where(eq(tasks.groupId, groupId)).run());
    out.availability = memberIds.length ? n(tx.delete(availability).where(inArray(availability.memberId, memberIds)).run()) : 0;
    out.agentMessages = memberIds.length ? n(tx.delete(agentMessages).where(inArray(agentMessages.memberId, memberIds)).run()) : 0;
    out.memory = n(tx.delete(userMemory).where(eq(userMemory.groupChatId, groupId)).run());
    out.members = n(tx.delete(members).where(eq(members.groupId, groupId)).run());
    out.pairCodes = n(tx.delete(cubbiePairCodes).where(eq(cubbiePairCodes.groupChatId, groupId)).run());
    out.imports = n(tx.delete(cubbieImports).where(eq(cubbieImports.groupChatId, groupId)).run());
    out.pending = n(tx.delete(pendingInputs).where(eq(pendingInputs.groupId, groupId)).run());
    tx.update(groups)
      .set({
        teamSize: null,
        status: 'setup',
        assignmentTitle: null,
        dueDate: null,
        statusMessageId: null,
        splitMessageId: null,
        availMessageId: null,
        lastCheckinAt: null,
        canvasCourse: null,
        availDeadlineAt: null,
      })
      .where(eq(groups.id, groupId))
      .run();
    return out;
  });
}
