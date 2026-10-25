import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { ProgressResponse, TaskStatus } from '@groupie/shared';
import { db, schema } from './db/index.ts';
import { getGroup, getTasks } from './groups.ts';
import { listMembers } from './members.ts';

/** Whole days from today (group tz) to the due date. Negative when overdue. */
export function daysLeft(dueDate: string | null, tz: string, now = new Date()): number | null {
  if (!dueDate) return null;
  const due = DateTime.fromISO(dueDate.slice(0, 10), { zone: tz }).startOf('day');
  if (!due.isValid) return null;
  const today = DateTime.fromJSDate(now, { zone: tz }).startOf('day');
  return Math.round(due.diff(today, 'days').days);
}

const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

export function progressView(groupId: number, meMemberId: number | null, now = new Date()): ProgressResponse {
  const group = getGroup(groupId)!;
  const tasks = getTasks(groupId);
  const members = listMembers(groupId).map((m) => {
    const mine = tasks.filter((t) => t.assigneeMemberId === m.id).sort((a, b) => b.effort - a.effort || a.id - b.id);
    const points = mine.reduce((s, t) => s + t.effort, 0);
    const done = mine.filter((t) => t.status === 'done').reduce((s, t) => s + t.effort, 0);
    return {
      id: m.id,
      name: m.name,
      color: m.color,
      is_me: m.id === meMemberId,
      points,
      done_points: done,
      percent: pct(done, points),
      tasks: mine.map((t) => ({ id: t.id, title: t.title, effort: t.effort, status: t.status as TaskStatus })),
    };
  });
  const total = tasks.reduce((s, t) => s + t.effort, 0);
  const done = tasks.filter((t) => t.status === 'done').reduce((s, t) => s + t.effort, 0);
  return {
    group_id: groupId,
    assignment_title: group.assignmentTitle,
    due_date: group.dueDate,
    days_left: daysLeft(group.dueDate, group.tz, now),
    total_points: total,
    done_points: done,
    percent: pct(done, total),
    members,
  };
}

export function getTask(taskId: number) {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
}

export function setTaskStatus(taskId: number, status: TaskStatus) {
  db.update(schema.tasks).set({ status }).where(eq(schema.tasks.id, taskId)).run();
}

export function markCheckin(groupId: number, at = new Date()) {
  db.update(schema.groups).set({ lastCheckinAt: at.toISOString() }).where(eq(schema.groups.id, groupId)).run();
}
