import { DateTime } from 'luxon';
import { formatMeeting, modeLabel } from '@groupie/shared';
import { getGroup, getTasks } from './groups.ts';
import { listMembers } from './members.ts';
import { latestMeeting } from './availability.ts';
import { daysLeft } from './progress.ts';
import { addDays, eventsForMembersInCourse, otherCourseCounts, upcomingForUser } from './calendarQueries.ts';
import { html } from './bot/format.ts';
import type { CalendarEvent, Member } from './db/schema.ts';

const STATUS: Record<string, string> = { todo: 'to do', on_track: 'on track', stuck: 'STUCK', done: 'done' };
const CANVAS_DAYS = 14;
const PRIVATE_CAP = 15;

const dueLabel = (e: CalendarEvent, tz: string) => DateTime.fromMillis(Date.parse(e.dueAt), { zone: tz }).toFormat('ccc, LLL d, h:mm a');

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
 * Everything the whole group can already see: tasks, owners, points, statuses, due date, meeting.
 * Never includes anyone's private chat with Groupie.
 */
export function groupContext(groupId: number, now = new Date()): string {
  const group = getGroup(groupId)!;
  const members = listMembers(groupId);
  const tasks = getTasks(groupId);
  const byId = new Map(members.map((m) => [m.id, m]));
  const today = DateTime.fromJSDate(now, { zone: group.tz });
  const left = daysLeft(group.dueDate, group.tz, now);
  const due = group.dueDate
    ? `${DateTime.fromISO(group.dueDate.slice(0, 10), { zone: group.tz }).toFormat('ccc, LLL d')} (${left === null ? '' : left < 0 ? `${-left} days overdue` : left === 0 ? 'today' : `${left} days left`})`
    : 'not stated';
  const lines = [
    `Group chat: ${group.title}. Team size: ${group.teamSize ?? members.length}.`,
    `Today: ${today.toFormat('cccc, LLL d, yyyy, h:mm a')} (${group.tz}).`,
    `Assignment: ${group.assignmentTitle ?? 'not uploaded yet'}. Due: ${due}.`,
  ];
  if (members.length) {
    lines.push('', 'Team (points done / assigned):');
    for (const m of members) {
      const mine = tasks.filter((t) => t.assigneeMemberId === m.id);
      const pts = mine.reduce((s, t) => s + t.effort, 0);
      const done = mine.filter((t) => t.status === 'done').reduce((s, t) => s + t.effort, 0);
      lines.push(`- ${m.name}: ${done}/${pts}`);
    }
  }
  if (tasks.length) {
    const total = tasks.reduce((n, t) => n + t.effort, 0);
    const done = tasks.filter((t) => t.status === 'done').reduce((n, t) => n + t.effort, 0);
    const stuck = tasks.filter((t) => t.status === 'stuck');
    const name = (id: number | null) => (id ? (byId.get(id)?.name ?? 'unknown') : 'unassigned');
    lines.push(
      '',
      `Overall: ${done} of ${total} points done (${total ? Math.round((done / total) * 100) : 0}%).`,
      `Stuck right now: ${stuck.length ? stuck.map((t) => `${name(t.assigneeMemberId)} on ${t.title}`).join('; ') : 'nobody (no task is marked stuck)'}.`,
    );
    lines.push('', 'Tasks:');
    for (const t of tasks) {
      const owner = t.assigneeMemberId ? (byId.get(t.assigneeMemberId)?.name ?? 'unknown') : 'unassigned';
      lines.push(`- ${t.title} (${t.effort} pt, ${STATUS[t.status] ?? t.status}, owner: ${owner})${t.description ? `: ${t.description}` : ''}`);
    }
  }
  const meeting = latestMeeting(groupId);
  if (meeting) {
    const where = meeting.mode === 'in_person' ? `in person${meeting.location ? ` at ${meeting.location}` : ''}` : `${modeLabel(meeting.mode)}${meeting.meetLink ? ` (${meeting.meetLink})` : ''}`;
    lines.push('', `Team meeting: ${formatMeeting(meeting.start, meeting.end, group.tz)}, ${meeting.mode ? where : 'how to meet not decided yet'}.`);
  } else {
    lines.push('', 'Team meeting: not scheduled yet.');
  }
  if (group.canvasCourse) {
    const items = groupCourseItems(groupId, now, addDays(now, CANVAS_DAYS));
    lines.push('', `Coming up (from Canvas, ${group.canvasCourse}, next ${CANVAS_DAYS} days):`);
    if (!items.length) lines.push('- nothing due (or nobody has connected their Canvas calendar)');
    for (const { event, owners } of items) lines.push(`- ${dueLabel(event, group.tz)}: ${event.title} (on the calendar of: ${owners.join(', ')})`);
  }
  return lines.join('\n');
}

/** Extra private context for one member's own chat: their profile, their tasks, and their own Canvas items. */
export function memberContext(member: Member, groupId: number, now = new Date()): string {
  const tasks = getTasks(groupId).filter((t) => t.assigneeMemberId === member.id);
  const lines = [
    `You are talking privately with ${member.name}.`,
    `Their skills: ${member.skills.join(', ') || 'not set'}. Would rather avoid: ${member.weakAreas.join(', ') || 'nothing listed'}.`,
    `Their tasks: ${tasks.length ? tasks.map((t) => `${t.title} (${t.effort} pt, ${STATUS[t.status] ?? t.status})`).join('; ') : 'none assigned yet'}.`,
  ];
  if (member.tgUserId !== null) {
    const tz = getGroup(groupId)!.tz;
    const items = upcomingForUser(member.tgUserId, now, addDays(now, CANVAS_DAYS), PRIVATE_CAP);
    lines.push(
      `Their own Canvas calendar, all their courses, next ${CANVAS_DAYS} days (private to ${member.name}; do not suggest sharing it):`,
      ...(items.length
        ? items.map((e) => `- ${dueLabel(e, tz)}: ${e.title}${e.course ? ` [${e.course}]` : ''}`)
        : ['- nothing due, or their Canvas calendar is not connected']),
    );
  }
  return lines.join('\n');
}

/**
 * Weekly check-in lines (Telegram HTML): this group's course items due in the next 7 days, then
 * per member counts of their other courses (numbers only, never titles). Empty without a Canvas course.
 */
export function weekAheadText(groupId: number, now = new Date()): string {
  const group = getGroup(groupId);
  if (!group?.canvasCourse) return '';
  const to = addDays(now, 7);
  const items = groupCourseItems(groupId, now, to);
  const lines: string[] = [];
  if (items.length) {
    const fmt = (e: CalendarEvent) => DateTime.fromMillis(Date.parse(e.dueAt), { zone: group.tz }).toFormat('ccc');
    lines.push(`<b>Due this week:</b> ${items.map(({ event }) => `${html(event.title)} (${fmt(event)})`).join(', ')}`);
  }
  const members = listMembers(groupId).filter((m) => m.tgUserId !== null);
  const counts = otherCourseCounts(members.map((m) => m.tgUserId!), group.canvasCourse, now, to);
  for (const m of members) {
    const n = counts[m.tgUserId!] ?? 0;
    if (n > 0) lines.push(`${html(m.name)} has ${n} other ${n === 1 ? 'thing' : 'things'} due this week.`);
  }
  return lines.join('\n');
}

export const voice = (nickname: string) =>
  `You are ${nickname}, a Telegram assistant called Groupie: "your group project's biggest fan". ` +
  'Warm, upbeat, a little cheeky, a superfan of this team, but never cringe. ' +
  'Be accurate: only use the facts provided. If something is not in the facts, say you do not know. Never invent tasks, dates, or links. ' +
  'Pronouns: never use he, him, his, she, her, or hers for anyone; use their name or they/them. ' +
  'Status words mean exactly what the facts say: only call someone stuck if the facts list them as stuck. ' +
  'Never use em dashes.';
