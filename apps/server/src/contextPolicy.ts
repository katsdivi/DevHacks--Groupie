import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { formatMeeting, modeLabel } from '@groupie/shared';
import { db, schema } from './db/index.ts';
import { getGroup, getTasks } from './groups.ts';
import { listMembers } from './members.ts';
import { latestMeeting } from './availability.ts';
import { daysLeft } from './progress.ts';
import { addDays, eventsForMembersInCourse, upcomingForUser } from './calendarQueries.ts';
import type { CalendarEvent } from './db/schema.ts';

/**
 * The ONLY path user data takes to the LLM. Every prompt builder calls buildContext() and renders
 * the buckets with renderContext(); nothing else may read user rows for a prompt.
 *
 * Rules (tested in contextPolicy.test.ts):
 * - Identity is the verified Telegram user id of the asker. Never a name or id from a request body.
 * - 'group' mode loads: group project facts, the asker's group-safe rows, and other members' rows
 *   that they explicitly shared with THIS group. Private rows are never loaded, not even the asker's.
 * - 'private' mode additionally loads the asker's own private rows. Never anyone else's.
 * - Other members' Canvas items count as shared only when they are in this group's course.
 */

export type ContextMode = 'group' | 'private';

export type MemoryFact = { key: string; value: string };
export type ItemFact = { title: string; course: string | null; dueAt: string; kind: string };
export type TaskFact = { title: string; effort: number; status: string; owner: string | null; description: string };

export type GroupFacts = {
  groupChatId: number;
  title: string;
  nickname: string;
  tz: string;
  teamSize: number | null;
  assignmentTitle: string | null;
  dueDate: string | null;
  daysLeft: number | null;
  canvasCourse: string | null;
  /** The start of the assignment's own text, so questions about the instructions can be answered. */
  instructions: string | null;
  members: { name: string; donePoints: number; points: number }[];
  tasks: TaskFact[];
  meeting: { label: string; mode: string | null; where: string | null } | null;
};

/** Characters of the assignment text rendered per group (about 1,000 tokens). */
export const INSTRUCTIONS_MAX = 4_000;
const clip = (s: string, max: number) => {
  const t = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > max ? `${t.slice(0, max)} ...(cut)` : t;
};

export type ContextBuckets = {
  mode: ContextMode;
  now: string;
  asker: { telegramUserId: number; memberId: number | null; name: string | null };
  /** Project facts the whole group already sees. Null outside a group. */
  group: GroupFacts | null;
  /** The asker's rows that are fine to show in this group. */
  ownGroupSafe: { tasks: TaskFact[]; memory: MemoryFact[]; courseItems: ItemFact[] };
  /** The asker's private rows. Always empty in 'group' mode (never even loaded). */
  ownPrivate: { profile: { skills: string[]; weakAreas: string[] } | null; memory: MemoryFact[]; calendarItems: ItemFact[] };
  /** Other members, only what they shared with this group. */
  membersShared: { name: string; memory: MemoryFact[]; courseItems: ItemFact[] }[];
};

export type BuildContextInput = {
  askerId: number;
  groupChatId: number | null;
  mode: ContextMode;
  now?: Date;
  /** Days of calendar items to include. */
  horizonDays?: number;
};

const HORIZON_DAYS = 14;
const PRIVATE_ITEM_CAP = 15;

const item = (e: CalendarEvent): ItemFact => ({ title: e.title, course: e.course, dueAt: e.dueAt, kind: e.kind });

/** Memory rows owned by `userId` with the given visibility (and group, for 'group' rows). */
function memoryRows(userId: number, visibility: 'private' | 'group', groupChatId: number | null): MemoryFact[] {
  if (visibility === 'group' && groupChatId === null) return [];
  const where =
    visibility === 'group'
      ? and(eq(schema.userMemory.telegramUserId, userId), eq(schema.userMemory.visibility, 'group'), eq(schema.userMemory.groupChatId, groupChatId!))
      : and(eq(schema.userMemory.telegramUserId, userId), eq(schema.userMemory.visibility, 'private'));
  return db
    .select()
    .from(schema.userMemory)
    .where(where)
    .orderBy(schema.userMemory.id)
    .all()
    .map((r) => ({ key: r.key, value: r.value }));
}

function groupFacts(groupChatId: number, now: Date): GroupFacts | null {
  const group = getGroup(groupChatId);
  if (!group) return null;
  const members = listMembers(groupChatId);
  const tasks = getTasks(groupChatId);
  const byId = new Map(members.map((m) => [m.id, m.name]));
  const meeting = latestMeeting(groupChatId);
  return {
    groupChatId,
    title: group.title,
    nickname: group.nickname,
    tz: group.tz,
    teamSize: group.teamSize,
    assignmentTitle: group.assignmentTitle,
    dueDate: group.dueDate,
    daysLeft: daysLeft(group.dueDate, group.tz, now),
    canvasCourse: group.canvasCourse,
    instructions: group.assignmentText ? clip(group.assignmentText, INSTRUCTIONS_MAX) : null,
    members: members.map((m) => {
      const mine = tasks.filter((t) => t.assigneeMemberId === m.id);
      return {
        name: m.name,
        points: mine.reduce((s, t) => s + t.effort, 0),
        donePoints: mine.filter((t) => t.status === 'done').reduce((s, t) => s + t.effort, 0),
      };
    }),
    tasks: tasks.map((t) => ({
      title: t.title,
      effort: t.effort,
      status: t.status,
      owner: t.assigneeMemberId ? (byId.get(t.assigneeMemberId) ?? null) : null,
      description: t.description,
    })),
    meeting: meeting
      ? {
          label: formatMeeting(meeting.start, meeting.end, group.tz),
          mode: meeting.mode,
          where: meeting.mode === 'in_person' ? meeting.location : meeting.meetLink,
        }
      : null,
  };
}

export function buildContext({ askerId, groupChatId, mode, now = new Date(), horizonDays = HORIZON_DAYS }: BuildContextInput): ContextBuckets {
  const to = addDays(now, horizonDays);
  const group = groupChatId === null ? null : groupFacts(groupChatId, now);
  const members = group ? listMembers(group.groupChatId) : [];
  const me = members.find((m) => m.tgUserId === askerId) ?? null;

  const myTasks = group && me ? group.tasks.filter((t) => t.owner === me.name) : [];
  const course = group?.canvasCourse ?? null;
  const courseItemsFor = (userId: number) => (course ? eventsForMembersInCourse([userId], course, now, to).map(item) : []);

  const buckets: ContextBuckets = {
    mode,
    now: now.toISOString(),
    asker: { telegramUserId: askerId, memberId: me?.id ?? null, name: me?.name ?? null },
    group,
    ownGroupSafe: {
      tasks: myTasks,
      memory: group ? memoryRows(askerId, 'group', group.groupChatId) : [],
      courseItems: courseItemsFor(askerId),
    },
    ownPrivate: { profile: null, memory: [], calendarItems: [] },
    membersShared: members
      .filter((m) => m.tgUserId !== null && m.tgUserId !== askerId)
      .map((m) => ({
        name: m.name,
        memory: memoryRows(m.tgUserId!, 'group', group!.groupChatId),
        courseItems: courseItemsFor(m.tgUserId!),
      })),
  };

  if (mode === 'private') {
    buckets.ownPrivate = {
      profile: me ? { skills: me.skills, weakAreas: me.weakAreas } : null,
      memory: memoryRows(askerId, 'private', null),
      calendarItems: upcomingForUser(askerId, now, to, PRIVATE_ITEM_CAP).map(item),
    };
  }
  return buckets;
}

const STATUS: Record<string, string> = { todo: 'to do', on_track: 'on track', stuck: 'STUCK', done: 'done' };

/** Renders buckets as the facts block an LLM sees. Prints exactly what is in the buckets. */
export function renderContext(b: ContextBuckets): string {
  const g = b.group;
  const tz = g?.tz ?? 'America/Phoenix';
  const when = (iso: string) => DateTime.fromMillis(Date.parse(iso), { zone: tz }).toFormat('ccc, LLL d, h:mm a');
  const lines: string[] = [];
  lines.push(`Today: ${DateTime.fromISO(b.now, { zone: tz }).toFormat('cccc, LLL d, yyyy, h:mm a')} (${tz}).`);
  lines.push(`Asker: ${b.asker.name ?? 'not a member of this group yet'}.`);

  if (g) {
    const due = g.dueDate
      ? `${DateTime.fromISO(g.dueDate.slice(0, 10), { zone: tz }).toFormat('ccc, LLL d')}${g.daysLeft === null ? '' : g.daysLeft < 0 ? ` (${-g.daysLeft} days overdue)` : g.daysLeft === 0 ? ' (today)' : ` (${g.daysLeft} days left)`}`
      : 'not stated';
    lines.push('', 'GROUP PROJECT (everyone in the group sees this)');
    lines.push(`Group chat: ${g.title}. Team size: ${g.teamSize ?? g.members.length}.`);
    lines.push(`Assignment: ${g.assignmentTitle ?? 'not uploaded yet'}. Due: ${due}.`);
    if (g.members.length) {
      lines.push('Team (points done / assigned):', ...g.members.map((m) => `- ${m.name}: ${m.donePoints}/${m.points}`));
    }
    if (g.tasks.length) {
      const total = g.tasks.reduce((n, t) => n + t.effort, 0);
      const done = g.tasks.filter((t) => t.status === 'done').reduce((n, t) => n + t.effort, 0);
      const stuck = g.tasks.filter((t) => t.status === 'stuck');
      lines.push(
        `Overall: ${done} of ${total} points done (${total ? Math.round((done / total) * 100) : 0}%).`,
        `Stuck right now: ${stuck.length ? stuck.map((t) => `${t.owner ?? 'unassigned'} on ${t.title}`).join('; ') : 'nobody (no task is marked stuck)'}.`,
        'Tasks:',
        ...g.tasks.map((t) => `- ${t.title} (${t.effort} pt, ${STATUS[t.status] ?? t.status}, owner: ${t.owner ?? 'unassigned'})${t.description ? `: ${t.description}` : ''}`),
      );
    }
    if (g.instructions) lines.push('Assignment instructions (from the file or Canvas, may be cut):', g.instructions);
    lines.push(
      g.meeting
        ? `Team meeting: ${g.meeting.label}, ${g.meeting.mode ? `${modeLabel(g.meeting.mode)}${g.meeting.where ? ` (${g.meeting.where})` : ''}` : 'how to meet not decided yet'}.`
        : 'Team meeting: not scheduled yet.',
    );
  }

  const own = b.ownGroupSafe;
  if (own.memory.length || own.courseItems.length) {
    lines.push('', `ASKER, SHARED WITH THIS GROUP`);
    lines.push(...own.memory.map((m) => `- ${m.key}: ${m.value}`));
    if (own.courseItems.length && g?.canvasCourse) {
      lines.push(`Their ${g.canvasCourse} items:`, ...own.courseItems.map((i) => `- ${when(i.dueAt)}: ${i.title}`));
    }
  }

  const shared = b.membersShared.filter((m) => m.memory.length || m.courseItems.length);
  if (g?.canvasCourse) {
    const byTitle = new Map<string, { item: ItemFact; owners: string[] }>();
    for (const m of [...b.membersShared, ...(b.asker.name ? [{ name: b.asker.name, courseItems: own.courseItems, memory: [] }] : [])]) {
      for (const i of m.courseItems) {
        const key = `${i.title}|${i.dueAt}`;
        const e = byTitle.get(key) ?? { item: i, owners: [] };
        if (!e.owners.includes(m.name)) e.owners.push(m.name);
        byTitle.set(key, e);
      }
    }
    lines.push('', `Coming up (from Canvas, ${g.canvasCourse}, next 14 days):`);
    if (!byTitle.size) lines.push('- nothing due (or nobody has connected their Canvas calendar)');
    for (const { item: i, owners } of [...byTitle.values()].sort((a, c) => a.item.dueAt.localeCompare(c.item.dueAt))) {
      lines.push(`- ${when(i.dueAt)}: ${i.title} (on the calendar of: ${owners.join(', ')})`);
    }
  }
  const sharedMemory = shared.filter((m) => m.memory.length);
  if (sharedMemory.length) {
    lines.push('', 'SHARED BY TEAMMATES WITH THIS GROUP (nothing else about them is known)');
    for (const m of sharedMemory) lines.push(`${m.name}:`, ...m.memory.map((f) => `- ${f.key}: ${f.value}`));
  }

  if (b.mode === 'private') {
    const p = b.ownPrivate;
    lines.push('', `PRIVATE TO ${b.asker.name ?? 'THE ASKER'} (never repeat in a group)`);
    if (p.profile) {
      lines.push(`Skills: ${p.profile.skills.join(', ') || 'not set'}. Would rather avoid: ${p.profile.weakAreas.join(', ') || 'nothing listed'}.`);
    }
    if (own.tasks.length) {
      lines.push(`Their tasks: ${own.tasks.map((t) => `${t.title} (${t.effort} pt, ${STATUS[t.status] ?? t.status})`).join('; ')}.`);
    }
    lines.push('Remembered:', ...(p.memory.length ? p.memory.map((m) => `- ${m.key}: ${m.value}`) : ['- nothing yet']));
    lines.push(
      'Their own Canvas calendar, all courses, next 14 days:',
      ...(p.calendarItems.length
        ? p.calendarItems.map((i) => `- ${when(i.dueAt)}: ${i.title}${i.course ? ` [${i.course}]` : ''}`)
        : ['- nothing due, or their Canvas calendar is not connected']),
    );
  }
  return lines.join('\n');
}
