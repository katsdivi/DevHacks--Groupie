import { and, eq, gt } from 'drizzle-orm';
export type { Group } from './db/schema.ts';
import { db, schema } from './db/index.ts';
import type { ParsedAssignment } from '@groupie/shared';
import { env } from './env.ts';

const { groups, pendingInputs, members, tasks } = schema;

export function getGroup(id: number) {
  return db.select().from(groups).where(eq(groups.id, id)).get();
}

export function upsertGroup(id: number, title: string) {
  const existing = getGroup(id);
  if (existing) {
    if (existing.title !== title) db.update(groups).set({ title }).where(eq(groups.id, id)).run();
    return { ...existing, title };
  }
  return db
    .insert(groups)
    .values({ id, title, tz: env.defaultTz, createdAt: new Date().toISOString() })
    .returning()
    .get();
}

export function setTeamSize(id: number, teamSize: number | null) {
  db.update(groups).set({ teamSize }).where(eq(groups.id, id)).run();
}

export function setStatusMessage(id: number, statusMessageId: number) {
  db.update(groups).set({ statusMessageId }).where(eq(groups.id, id)).run();
}

/** Wipes the group and everything hanging off it (cascades). */
export function deleteGroup(id: number) {
  db.transaction((tx) => {
    tx.delete(pendingInputs).where(eq(pendingInputs.groupId, id)).run();
    tx.delete(groups).where(eq(groups.id, id)).run();
  });
}

/** Dev snapshot: every group with member and task counts. */
export function devState() {
  return db
    .select()
    .from(groups)
    .all()
    .map((g) => ({
      ...g,
      members: db.select().from(members).where(eq(members.groupId, g.id)).all(),
      tasks: db.select().from(tasks).where(eq(tasks.groupId, g.id)).all(),
    }));
}

export function setNickname(id: number, nickname: string) {
  db.update(groups).set({ nickname }).where(eq(groups.id, id)).run();
}

/** Telegram moves a group to a new id when it becomes a supergroup. */
export function migrateGroupId(fromId: number, toId: number) {
  db.transaction((tx) => {
    tx.update(groups).set({ id: toId }).where(eq(groups.id, fromId)).run();
    tx.update(pendingInputs).set({ groupId: toId }).where(eq(pendingInputs.groupId, fromId)).run();
  });
}

const PENDING_MS = 2 * 60 * 1000;

export function setPending(groupId: number, tgUserId: number, kind: 'nickname' | 'rename') {
  const expiresAt = new Date(Date.now() + PENDING_MS).toISOString();
  db.insert(pendingInputs)
    .values({ groupId, tgUserId, kind, expiresAt })
    .onConflictDoUpdate({ target: [pendingInputs.groupId, pendingInputs.tgUserId], set: { kind, expiresAt } })
    .run();
}

export function getPending(groupId: number, tgUserId: number) {
  return db
    .select()
    .from(pendingInputs)
    .where(
      and(
        eq(pendingInputs.groupId, groupId),
        eq(pendingInputs.tgUserId, tgUserId),
        gt(pendingInputs.expiresAt, new Date().toISOString()),
      ),
    )
    .get();
}

export function clearPending(groupId: number, tgUserId: number) {
  db.delete(pendingInputs)
    .where(and(eq(pendingInputs.groupId, groupId), eq(pendingInputs.tgUserId, tgUserId)))
    .run();
}

/** Stores a parsed assignment, replacing any earlier task list, and opens member collection. */
export function saveAssignment(groupId: number, parsed: ParsedAssignment) {
  db.transaction((tx) => {
    tx.delete(tasks).where(eq(tasks.groupId, groupId)).run();
    for (const t of parsed.tasks) {
      tx.insert(tasks)
        .values({
          groupId,
          title: t.title,
          description: t.description,
          effort: t.effort,
          skillTags: t.skill_tags,
          dueDate: parsed.due_date,
        })
        .run();
    }
    tx.update(groups)
      .set({ assignmentTitle: parsed.assignment_title, dueDate: parsed.due_date, status: 'collecting_members' })
      .where(eq(groups.id, groupId))
      .run();
  });
}

export function getTasks(groupId: number) {
  return db.select().from(tasks).where(eq(tasks.groupId, groupId)).orderBy(tasks.id).all();
}

export function countMembers(groupId: number) {
  return db.select().from(members).where(eq(members.groupId, groupId)).all().length;
}
