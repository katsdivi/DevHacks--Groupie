import { and, eq } from 'drizzle-orm';
import {
  planSwap,
  split,
  type SplitConstraints,
  type SplitResponse,
  type SplitResult,
  type SplitTaskView,
  type TaskStatus,
} from '@groupie/shared';
import { db, schema } from './db/index.ts';
import type { Member, Task } from './db/schema.ts';
import { getGroup, getTasks } from './groups.ts';
import { listMembers } from './members.ts';
import { formatDue } from './bot/format.ts';
import { adjustmentLine, type SplitCardData } from './cards/splitCard.ts';
import { env } from './env.ts';
import { BUSY_THRESHOLD, loadScores, projectWindowEnd, type LoadScore } from './calendarQueries.ts';

const { tasks: tasksTable, groups, swapRequests, splitVotes } = schema;

const toSplitTask = (t: Task) => ({ id: t.id, effort: t.effort, skill_tags: t.skillTags });
const toSplitMember = (m: Member) => ({ id: m.id, skills: m.skills, weak_areas: m.weakAreas });

/** Constraints from past swaps: the requester never gets that task back, and a named target keeps it. */
export function swapConstraints(groupId: number): Required<SplitConstraints> {
  const rows = db.select().from(swapRequests).where(eq(swapRequests.groupId, groupId)).orderBy(swapRequests.id).all();
  const locked: Record<number, number> = {};
  const forbidden: { task_id: number; member_id: number }[] = [];
  for (const r of rows) {
    if (r.status !== 'applied') continue;
    forbidden.push({ task_id: r.taskId, member_id: r.fromMemberId });
    if (r.toMemberId) locked[r.taskId] = r.toMemberId;
    else delete locked[r.taskId];
  }
  // A later swap away from someone overrides an earlier lock onto them.
  for (const f of forbidden) if (locked[f.task_id] === f.member_id) delete locked[f.task_id];
  return { locked, forbidden };
}

/** Members whose calendar may shape the split: opted in, with a Telegram account, and only while the flag is on. */
function sharingMembers(groupId: number): Member[] {
  if (!env.loadAwareSplit) return [];
  return listMembers(groupId).filter((m) => m.shareWorkload && m.tgUserId !== null);
}

/**
 * memberId -> calendar load over the project window, for opted-in members only (see sharingMembers).
 * Everyone else is absent, which the split treats as load 0.
 */
export function memberLoads(groupId: number, now = new Date()): Record<number, LoadScore> {
  const members = sharingMembers(groupId);
  if (!members.length) return {};
  const group = getGroup(groupId)!;
  const scores = loadScores(members.map((m) => m.tgUserId!), now, projectWindowEnd(group.dueDate, now));
  return Object.fromEntries(members.map((m) => [m.id, scores[m.tgUserId!]!]));
}

/** Member ids that got fewer points with load than in the no-load baseline. Pure. */
export function fewerPointsThanBaseline(baseline: SplitResult, result: SplitResult): number[] {
  return Object.keys(result.totals)
    .map(Number)
    .filter((id) => result.totals[id]! < (baseline.totals[id] ?? 0))
    .sort((a, b) => a - b);
}

export type SplitWithBaseline = { result: SplitResult; baseline: SplitResult; adjusted: number[] };

/**
 * The split plus the no-load baseline it is compared against. Load is only computed and passed when
 * the flag is on and someone opted in; otherwise `result` is exactly the no-load split.
 */
export function computeSplitWithBaseline(
  groupId: number,
  constraints: SplitConstraints = swapConstraints(groupId),
  now = new Date(),
): SplitWithBaseline {
  const tasks = getTasks(groupId).map(toSplitTask);
  const members = listMembers(groupId).map(toSplitMember);
  const baseline = split(tasks, members, constraints);
  const loads = memberLoads(groupId, now);
  if (!Object.keys(loads).length) return { result: baseline, baseline, adjusted: [] };
  const load = Object.fromEntries(Object.entries(loads).map(([id, l]) => [id, l.score]));
  const result = split(tasks, members, constraints, { load });
  return { result, baseline, adjusted: fewerPointsThanBaseline(baseline, result) };
}

export function computeSplit(groupId: number, constraints: SplitConstraints = swapConstraints(groupId)): SplitResult {
  return computeSplitWithBaseline(groupId, constraints).result;
}

/** Writes assignees, clears "looks fair" votes, and marks the group split_ready. */
export function applySplit(groupId: number, result: SplitResult) {
  db.transaction((tx) => {
    for (const [taskId, memberId] of Object.entries(result.assignments)) {
      tx.update(tasksTable).set({ assigneeMemberId: memberId }).where(eq(tasksTable.id, Number(taskId))).run();
    }
    tx.delete(splitVotes).where(eq(splitVotes.groupId, groupId)).run();
    const g = tx.select().from(groups).where(eq(groups.id, groupId)).get();
    if (g && (g.status === 'collecting_members' || g.status === 'setup')) {
      tx.update(groups).set({ status: 'split_ready' }).where(eq(groups.id, groupId)).run();
    }
  });
}

/** Current persisted split (or a live preview when `preview` is given). */
export function splitView(groupId: number, meMemberId: number | null, preview?: SplitResult): SplitResponse {
  const group = getGroup(groupId)!;
  const tasks = getTasks(groupId);
  const members = listMembers(groupId);
  const owner = (t: Task) => (preview ? (preview.assignments[t.id] ?? null) : t.assigneeMemberId);
  const view = (t: Task): SplitTaskView => ({
    id: t.id,
    title: t.title,
    description: t.description,
    effort: t.effort,
    skill_tags: t.skillTags,
    status: t.status as TaskStatus,
  });
  const memberViews = members.map((m) => {
    const mine = tasks.filter((t) => owner(t) === m.id).sort((a, b) => b.effort - a.effort || a.id - b.id);
    return {
      id: m.id,
      name: m.name,
      color: m.color,
      points: mine.reduce((s, t) => s + t.effort, 0),
      is_me: m.id === meMemberId,
      tasks: mine.map(view),
    };
  });
  const points = memberViews.map((m) => m.points);
  return {
    group_id: groupId,
    assignment_title: group.assignmentTitle,
    due_date: group.dueDate,
    total_points: tasks.reduce((s, t) => s + t.effort, 0),
    max_gap: points.length ? Math.max(...points) - Math.min(...points) : 0,
    members: memberViews,
    unassigned: tasks.filter((t) => owner(t) === null || !members.some((m) => m.id === owner(t))).map(view),
  };
}

/** "Busy week" for opted-in members with 3+ calendar items due in the next 7 days. Never a count or a course. */
export function busyLabels(groupId: number, now = new Date()): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [id, l] of Object.entries(memberLoads(groupId, now))) {
    if (l.dueSoon >= BUSY_THRESHOLD) out[Number(id)] = 'Busy week';
  }
  return out;
}

/**
 * Members on this view who got fewer points because of their busy week: the load-aware split gave
 * them less than the no-load one, and the view still shows that load-aware share.
 */
export function adjustedMembers(view: SplitResponse, now = new Date()): number[] {
  const { result, adjusted } = computeSplitWithBaseline(view.group_id, swapConstraints(view.group_id), now);
  const shown = new Map(view.members.map((m) => [m.id, m.points]));
  return adjusted.filter((id) => shown.get(id) === result.totals[id]);
}

export function splitCardData(view: SplitResponse, now = new Date()): SplitCardData {
  const group = getGroup(view.group_id)!;
  const busy = busyLabels(view.group_id, now);
  const adjusted = new Set(adjustedMembers(view, now));
  const note = adjustmentLine(view.members.filter((m) => adjusted.has(m.id)).map((m) => m.name));
  return {
    assignmentTitle: view.assignment_title ?? 'Group project',
    dueLabel: formatDue(view.due_date, group.tz),
    nickname: group.nickname,
    maxGap: view.max_gap,
    members: view.members.map((m) => ({
      name: m.name,
      color: m.color,
      points: m.points,
      tasks: m.tasks.map((t) => ({ title: t.title, effort: t.effort })),
      ...(busy[m.id] ? { busyLabel: busy[m.id] } : {}),
    })),
    ...(note ? { note } : {}),
  };
}

export class SwapError extends Error {}

/** A swap may cost at most this much extra gap versus a full rebalance, to keep everyone else's tasks put. */
const SWAP_GAP_TOLERANCE = 2;

/**
 * Moves one of the requester's tasks away, optionally to a named teammate. Uses the plan that
 * changes the fewest tasks unless a full rebalance is much fairer.
 */
export function requestSwap(groupId: number, fromMemberId: number, taskId: number, toMemberId: number | null) {
  const tasks = getTasks(groupId);
  const members = listMembers(groupId);
  const task = tasks.find((t) => t.id === taskId);
  if (!task || task.assigneeMemberId !== fromMemberId) throw new SwapError("That task isn't yours to swap.");
  if (toMemberId !== null && (toMemberId === fromMemberId || !members.some((m) => m.id === toMemberId))) {
    throw new SwapError('Pick a teammate in this group.');
  }

  const current: Record<number, number> = {};
  for (const t of tasks) if (t.assigneeMemberId) current[t.id] = t.assigneeMemberId;
  const before = swapConstraints(groupId);
  const constraints = {
    locked: { ...before.locked },
    forbidden: [...before.forbidden, { task_id: taskId, member_id: fromMemberId }],
  };
  delete constraints.locked[taskId];
  if (toMemberId) constraints.locked[taskId] = toMemberId;

  const plan = planSwap(
    tasks.map(toSplitTask),
    members.map(toSplitMember),
    current,
    taskId,
    fromMemberId,
    toMemberId,
    constraints,
  );
  if (!plan) throw new SwapError("Nobody can take that one right now. Try another task?");
  const full = computeSplit(groupId, constraints);
  const result = plan.maxGap <= full.maxGap + SWAP_GAP_TOLERANCE ? plan : full;

  db.insert(swapRequests)
    .values({ groupId, fromMemberId, taskId, toMemberId, status: 'applied', createdAt: new Date().toISOString() })
    .run();
  applySplit(groupId, result);
  return { result, moved: { task_id: taskId, from_member_id: fromMemberId, to_member_id: result.assignments[taskId]! } };
}

export function addFairVote(groupId: number, tgUserId: number): boolean {
  const res = db.insert(splitVotes).values({ groupId, tgUserId }).onConflictDoNothing().run();
  return res.changes > 0;
}

export function countFairVotes(groupId: number): number {
  return db.select().from(splitVotes).where(eq(splitVotes.groupId, groupId)).all().length;
}

export function setSplitMessage(groupId: number, splitMessageId: number | null) {
  db.update(groups).set({ splitMessageId }).where(and(eq(groups.id, groupId))).run();
}
