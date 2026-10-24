import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from './db/index.ts';
import { env } from './env.ts';

const { groups, pendingInputs } = schema;

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
