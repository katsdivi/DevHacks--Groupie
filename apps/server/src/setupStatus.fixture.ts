import { db, schema } from './db/index.ts';

/** Test rows for the setup checklist, one per source table. */
const now = new Date().toISOString();

export function seedGroup(id: number, status: (typeof schema.groups.$inferInsert)['status'] = 'collecting_members', title = 'Team Alpha') {
  db.insert(schema.groups).values({ id, title, status, teamSize: 4, tz: 'America/Phoenix', createdAt: now }).run();
}
export const seed = {
  member: (userId: number, groupId: number) =>
    db.insert(schema.members).values({ groupId, tgUserId: userId, name: 'Ana', color: '#FF6B5B', createdAt: now }).run(),
  calendar: (userId: number, secret: string | null = 'enc') =>
    db.insert(schema.calendarConnections).values({ telegramUserId: userId, kind: 'ics', icsUrlEncrypted: secret, createdAt: now }).run(),
  feed: (userId: number) => db.insert(schema.calendarFeeds).values({ telegramUserId: userId, feedUrlEncrypted: 'enc', createdAt: now }).run(),
  link: (userId: number, revoked = false) =>
    db
      .insert(schema.cubbieLinks)
      .values({ telegramUserId: userId, tokenHash: `h${userId}${Math.random()}`, createdAt: now, revokedAt: revoked ? now : null })
      .run(),
  /** A pending group: they made an import code there but have not added details. */
  pending: (userId: number, groupId: number) =>
    db.insert(schema.cubbiePairCodes).values({ code: `P${userId}`, telegramUserId: userId, groupChatId: groupId, expiresAt: now, createdAt: now }).run(),
  dm: (userId: number) => db.insert(schema.userPrefs).values({ telegramUserId: userId, canDm: true, updatedAt: now }).run(),
};
export function wipe() {
  for (const t of [schema.members, schema.groups, schema.calendarConnections, schema.calendarFeeds, schema.cubbieLinks, schema.userPrefs, schema.cubbiePairCodes, schema.cubbieImports]) {
    db.delete(t).run();
  }
}

