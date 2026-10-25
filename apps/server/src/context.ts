import { DateTime } from 'luxon';
import { getGroup } from './groups.ts';
import { listMembers } from './members.ts';
import { addDays, eventsForMembersInCourse } from './calendarQueries.ts';
import { html } from './bot/format.ts';
import type { CalendarEvent } from './db/schema.ts';
import { eq } from 'drizzle-orm';
import { db, schema } from './db/index.ts';
import { buildContext, type ContextBuckets } from './contextPolicy.ts';

/**
 * Prompt facts come only from contextPolicy.buildContext() (see bot/qa.ts and agent.ts). This file
 * keeps the persona, the weekly check-in line, and pure narrowing helpers over the buckets.
 */

/**
 * This group's course items from members' Canvas calendars, one per Canvas uid with every owner.
 * Empty when the group has no Canvas course; other courses never get in (eventsForMembersInCourse).
 */
function groupCourseItems(groupId: number, from: Date, to: Date) {
  const group = getGroup(groupId)!;
  if (!group.canvasCourse) return [];
  const members = listMembers(groupId).filter((m) => m.tgUserId !== null);
  const names = new Map(members.map((m) => [m.tgUserId!, m.name]));
  const byUid = new Map<string, { event: CalendarEvent; owners: string[] }>();
  for (const e of eventsForMembersInCourse([...names.keys()], group.canvasCourse, from, to)) {
    const item = byUid.get(e.uid) ?? { event: e, owners: [] };
    const name = names.get(e.telegramUserId)!;
    if (!item.owners.includes(name)) item.owners.push(name);
    byUid.set(e.uid, item);
  }
  return [...byUid.values()];
}

/**
 * Weekly check-in line (Telegram HTML): this group's course items due in the next 7 days. Nothing
 * about other courses, not even counts. Empty without a Canvas course or items.
 */
export function weekAheadText(groupId: number, now = new Date()): string {
  const group = getGroup(groupId);
  if (!group?.canvasCourse) return '';
  const items = groupCourseItems(groupId, now, addDays(now, 7));
  if (!items.length) return '';
  const fmt = (e: CalendarEvent) => DateTime.fromMillis(Date.parse(e.dueAt), { zone: group.tz }).toFormat('ccc');
  return `<b>Due this week:</b> ${items.map(({ event }) => `${html(event.title)} (${fmt(event)})`).join(', ')}`;
}

export const voice = (nickname: string) =>
  `You are ${nickname}, a Telegram assistant called Groupie: "your group project's biggest fan". ` +
  'Warm, upbeat, a little cheeky, a superfan of this team, but never cringe. ' +
  'Be accurate: only use the facts provided. If something is not in the facts, say you do not know. Never invent tasks, dates, or links. ' +
  'Pronouns: never use he, him, his, she, her, or hers for anyone; use their name or they/them. ' +
  'Status words mean exactly what the facts say: only call someone stuck if the facts list them as stuck. ' +
  'Never use em dashes.';

/** Buckets narrowed to one teammate: group facts plus only what that teammate shared with this group. */
export function onlyMember(b: ContextBuckets, name: string): ContextBuckets {
  return {
    ...b,
    ownGroupSafe: { tasks: [], memory: [], courseItems: [] },
    ownPrivate: { profile: null, memory: [], calendarItems: [] },
    membersShared: b.membersShared.filter((m) => m.name === name),
  };
}

/** Buckets with teammates' shared rows dropped, for answers that are only about the asker. */
export const withoutTeammates = (b: ContextBuckets): ContextBuckets => ({ ...b, membersShared: [] });

/** True when a teammate shared anything at all with this group. */
export const sharedAnything = (b: ContextBuckets, name: string) =>
  b.membersShared.some((m) => m.name === name && (m.memory.length > 0 || m.courseItems.length > 0));

export type DmContext = {
  /** The asker's own private rows (memory, all-course calendar), loaded once with no group. */
  own: ContextBuckets;
  /** One group-safe view per group the asker is a member of. */
  groups: ContextBuckets[];
};

/**
 * Context for a private Telegram DM, keyed only by the sender's Telegram id. Every row still comes
 * from buildContext: one private-mode call with no group, then a group-mode call per group they
 * belong to (so private rows are rendered exactly once and never mixed into a group section).
 */
export function buildDmContext(askerId: number, now = new Date()): DmContext {
  const ids = [
    ...new Set(
      db
        .select({ groupId: schema.members.groupId })
        .from(schema.members)
        .where(eq(schema.members.tgUserId, askerId))
        .all()
        .map((r) => r.groupId),
    ),
  ].filter((id) => getGroup(id));
  const groups = ids.map((groupChatId) => buildContext({ askerId, groupChatId, mode: 'group', now }));
  const own = buildContext({ askerId, groupChatId: null, mode: 'private', now });
  const name = groups.find((g) => g.asker.name)?.asker.name ?? null;
  return { own: { ...own, asker: { ...own.asker, name } }, groups };
}
