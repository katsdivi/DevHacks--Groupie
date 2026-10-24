import { describe, expect, it } from 'vitest';
import { planSwap } from './swap.ts';
import { split } from './split.ts';

const efforts = [3, 2, 5, 3, 5, 3, 5, 8, 3, 5, 2, 2, 3];
const tasks = efforts.map((effort, i) => ({ id: i + 1, effort, skill_tags: [] as string[] }));
const members = [1, 2, 3, 4, 5].map((id) => ({ id, skills: [] as string[], weak_areas: [] as string[] }));

describe('planSwap', () => {
  const current = split(tasks, members).assignments;
  const mine = Object.entries(current).filter(([, m]) => m === 1).map(([t]) => Number(t));

  it('moves the task to the named teammate and keeps changes small', () => {
    const taskId = mine[mine.length - 1]!;
    const plan = planSwap(tasks, members, current, taskId, 1, 5)!;
    expect(plan.assignments[taskId]).toBe(5);
    expect(plan.changed).toBeLessThanOrEqual(3);
    expect(plan.maxGap).toBeLessThanOrEqual(3);
  });

  it('never gives the task back to the requester or breaks forbidden pairs', () => {
    const taskId = mine[0]!;
    const plan = planSwap(tasks, members, current, taskId, 1, null, { forbidden: [{ task_id: taskId, member_id: 1 }] })!;
    expect(plan.assignments[taskId]).not.toBe(1);
  });

  it('keeps locked tasks where they are', () => {
    const taskId = mine[0]!;
    const other = Number(Object.entries(current).find(([, m]) => m === 2)![0]);
    const plan = planSwap(tasks, members, current, taskId, 1, null, { locked: { [other]: 2 } })!;
    expect(plan.assignments[other]).toBe(2);
  });

  it('returns null when nobody may take the task', () => {
    const taskId = mine[0]!;
    const forbidden = [2, 3, 4, 5].map((m) => ({ task_id: taskId, member_id: m }));
    expect(planSwap(tasks, members, current, taskId, 1, null, { forbidden })).toBeNull();
  });
});
