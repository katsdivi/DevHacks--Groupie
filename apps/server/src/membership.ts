import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from './db/index.ts';
import { getGroup, type Group } from './groups.ts';

/**
 * Which project groups a Telegram user belongs to, and whether their iMessage is linked.
 * Keyed only by the verified Telegram user id.
 */

const { cubbieImports, cubbieLinks, cubbiePairCodes, members } = schema;

/** True when the user has a live (not revoked) iMessage link. */
export function isLinked(userId: number): boolean {
  return !!db
    .select({ id: cubbieLinks.id })
    .from(cubbieLinks)
    .where(and(eq(cubbieLinks.telegramUserId, userId), isNull(cubbieLinks.revokedAt)))
    .limit(1)
    .get();
}

export type ProjectGroup = { group: Group; joined: boolean };

/**
 * Groups with a member row for this user (joined), then groups where they made a pair code or an
 * import but have not added their details yet (pending, newest first). Deleted groups are skipped.
 */
export function projectGroupsFor(userId: number): ProjectGroup[] {
  const joinedIds = db
    .select({ id: members.groupId })
    .from(members)
    .where(eq(members.tgUserId, userId))
    .orderBy(members.id)
    .all()
    .map((r) => r.id);
  const codeIds = db
    .select({ id: cubbiePairCodes.groupChatId, at: cubbiePairCodes.createdAt })
    .from(cubbiePairCodes)
    .where(and(eq(cubbiePairCodes.telegramUserId, userId), isNotNull(cubbiePairCodes.groupChatId), eq(cubbiePairCodes.purpose, 'import')))
    .all();
  const importIds = db
    .select({ id: cubbieImports.groupChatId, at: cubbieImports.createdAt })
    .from(cubbieImports)
    .where(and(eq(cubbieImports.telegramUserId, userId), isNotNull(cubbieImports.groupChatId)))
    .orderBy(desc(cubbieImports.id))
    .all();
  const pendingIds = [...codeIds, ...importIds].sort((a, b) => b.at.localeCompare(a.at)).map((r) => r.id!);
  const out: ProjectGroup[] = [];
  const seen = new Set<number>();
  const add = (id: number, joined: boolean) => {
    if (seen.has(id)) return;
    seen.add(id);
    const group = getGroup(id);
    if (group) out.push({ group, joined });
  };
  joinedIds.forEach((id) => add(id, true));
  pendingIds.forEach((id) => add(id, false));
  return out;
}

/** Joined groups only. */
export const joinedGroupsFor = (userId: number) => projectGroupsFor(userId).filter((g) => g.joined);
