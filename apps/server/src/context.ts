import { DateTime } from 'luxon';
import { formatMeeting, modeLabel } from '@groupie/shared';
import { getGroup, getTasks } from './groups.ts';
import { listMembers } from './members.ts';
import { latestMeeting } from './availability.ts';
import { daysLeft } from './progress.ts';
import type { Member } from './db/schema.ts';

const STATUS: Record<string, string> = { todo: 'to do', on_track: 'on track', stuck: 'STUCK', done: 'done' };

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
  return lines.join('\n');
}

/** Extra private context for one member's own chat: their profile and their tasks. */
export function memberContext(member: Member, groupId: number): string {
  const tasks = getTasks(groupId).filter((t) => t.assigneeMemberId === member.id);
  return [
    `You are talking privately with ${member.name}.`,
    `Their skills: ${member.skills.join(', ') || 'not set'}. Would rather avoid: ${member.weakAreas.join(', ') || 'nothing listed'}.`,
    `Their tasks: ${tasks.length ? tasks.map((t) => `${t.title} (${t.effort} pt, ${STATUS[t.status] ?? t.status})`).join('; ') : 'none assigned yet'}.`,
  ].join('\n');
}

export const voice = (nickname: string) =>
  `You are ${nickname}, a Telegram assistant called Groupie: "your group project's biggest fan". ` +
  'Warm, upbeat, a little cheeky, a superfan of this team, but never cringe. ' +
  'Be accurate: only use the facts provided. If something is not in the facts, say you do not know. Never invent tasks, dates, or links. ' +
  'Pronouns: never use he, him, his, she, her, or hers for anyone; use their name or they/them. ' +
  'Status words mean exactly what the facts say: only call someone stuck if the facts list them as stuck. ' +
  'Never use em dashes.';
