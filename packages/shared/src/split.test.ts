import { describe, expect, it } from 'vitest';
import { skillFit, split, type SplitMember, type SplitTask } from './split.ts';

const member = (id: number, skills: string[] = [], weak_areas: string[] = []): SplitMember => ({ id, skills, weak_areas });
const task = (id: number, effort: number, skill_tags: string[] = []): SplitTask => ({ id, effort, skill_tags });

/** Tiny seeded PRNG (mulberry32). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Naive baseline: largest first, to the lowest total, ties by member id. */
function greedyGap(tasks: SplitTask[], members: SplitMember[]): number {
  const ms = [...members].sort((a, b) => a.id - b.id);
  const totals = ms.map(() => 0);
  const sorted = [...tasks].sort((a, b) => b.effort - a.effort || a.id - b.id);
  for (const t of sorted) {
    const m = totals.indexOf(Math.min(...totals));
    totals[m]! += t.effort;
  }
  return Math.max(...totals) - Math.min(...totals);
}

function checkInvariants(tasks: SplitTask[], members: SplitMember[], r: ReturnType<typeof split>) {
  expect(Object.keys(r.assignments).map(Number).sort((a, b) => a - b)).toEqual(tasks.map((t) => t.id).sort((a, b) => a - b));
  const memberIds = new Set(members.map((m) => m.id));
  for (const m of Object.values(r.assignments)) expect(memberIds.has(m)).toBe(true);
  expect(Object.keys(r.totals).map(Number).sort((a, b) => a - b)).toEqual([...memberIds].sort((a, b) => a - b));
  const sum = Object.values(r.totals).reduce((s, v) => s + v, 0);
  expect(sum).toBe(tasks.reduce((s, t) => s + t.effort, 0));
  for (const m of members) {
    const own = tasks.filter((t) => r.assignments[t.id] === m.id).reduce((s, t) => s + t.effort, 0);
    expect(r.totals[m.id]).toBe(own);
  }
  const vals = Object.values(r.totals);
  expect(r.maxGap).toBe(Math.max(...vals) - Math.min(...vals));
}

const EFFORTS = [1, 2, 3, 5, 8];
const TAGS = ['writing', 'research', 'coding', 'design', 'data', 'presenting', 'editing', 'math'];

function randomCase(seed: number) {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const tags = () => TAGS.filter(() => r() < 0.2).slice(0, 3);
  const nM = 1 + Math.floor(r() * 6);
  const nT = Math.floor(r() * 21);
  const members = Array.from({ length: nM }, (_, i) => member(100 + i, tags(), tags()));
  const tasks = Array.from({ length: nT }, (_, i) => task(i + 1, pick(EFFORTS), tags()));
  return { tasks, members };
}

describe('split', () => {
  it('spreads equal-effort tasks evenly', () => {
    const tasks = Array.from({ length: 9 }, (_, i) => task(i + 1, 3));
    const members = [member(1), member(2), member(3)];
    const r = split(tasks, members);
    expect(r.totals).toEqual({ 1: 9, 2: 9, 3: 9 });
    expect(r.maxGap).toBe(0);
    checkInvariants(tasks, members, r);
  });

  it('balances one huge task against many small ones', () => {
    const tasks = [task(1, 8), ...Array.from({ length: 8 }, (_, i) => task(i + 2, 1))];
    const members = [member(1), member(2)];
    const r = split(tasks, members);
    const bigOwner = r.assignments[1]!;
    expect(r.totals[bigOwner]).toBe(8);
    expect(r.maxGap).toBe(0);
    checkInvariants(tasks, members, r);
  });

  it('handles more members than tasks', () => {
    const tasks = [task(1, 5), task(2, 3)];
    const members = [member(1), member(2), member(3), member(4)];
    const r = split(tasks, members);
    expect(new Set(Object.values(r.assignments)).size).toBe(2);
    expect(Object.values(r.totals).sort()).toEqual([0, 0, 3, 5]);
    expect(r.maxGap).toBe(5);
    checkInvariants(tasks, members, r);
  });

  it('handles zero members and zero tasks', () => {
    expect(split([task(1, 3)], [])).toEqual({ assignments: {}, totals: {}, maxGap: 0 });
    expect(split([], [member(1), member(2)])).toEqual({ assignments: {}, totals: { 1: 0, 2: 0 }, maxGap: 0 });
  });

  it('honors locked assignments even when that hurts balance', () => {
    const tasks = [task(1, 8), task(2, 5), task(3, 3), task(4, 2)];
    const members = [member(1), member(2)];
    const r = split(tasks, members, { locked: { 1: 1, 2: 1 } });
    expect(r.assignments[1]).toBe(1);
    expect(r.assignments[2]).toBe(1);
    expect(r.assignments[3]).toBe(2);
    expect(r.assignments[4]).toBe(2);
    checkInvariants(tasks, members, r);
  });

  it('never creates forbidden pairs', () => {
    const tasks = [task(1, 8), task(2, 5), task(3, 3), task(4, 3), task(5, 2)];
    const members = [member(1), member(2), member(3)];
    const forbidden = [
      { task_id: 1, member_id: 1 },
      { task_id: 1, member_id: 2 },
      { task_id: 2, member_id: 3 },
    ];
    const r = split(tasks, members, { forbidden });
    expect(r.assignments[1]).toBe(3);
    expect(r.assignments[2]).not.toBe(3);
    checkInvariants(tasks, members, r);
  });

  it('still assigns a task that is forbidden for everyone', () => {
    const tasks = [task(1, 3), task(2, 2)];
    const members = [member(1), member(2)];
    const forbidden = [
      { task_id: 1, member_id: 1 },
      { task_id: 1, member_id: 2 },
    ];
    const r = split(tasks, members, { forbidden });
    expect(r.assignments[1]).toBeDefined();
    checkInvariants(tasks, members, r);
  });

  it('keeps the coding task away from someone weak in coding when loads are equal', () => {
    const tasks = [task(1, 3, ['coding']), task(2, 3, ['writing'])];
    const members = [member(1, [], ['coding']), member(2)];
    const r = split(tasks, members);
    expect(r.assignments[1]).toBe(2);
    expect(r.assignments[2]).toBe(1);
  });

  it('prefers members whose skills match the task', () => {
    const tasks = [task(1, 5, ['design']), task(2, 5, ['data']), task(3, 2, ['writing']), task(4, 2, ['math'])];
    const members = [member(1, ['data', 'math']), member(2, ['design', 'writing'])];
    const r = split(tasks, members);
    expect(r.assignments).toEqual({ 1: 2, 2: 1, 3: 2, 4: 1 });
    expect(r.maxGap).toBe(0);
  });

  it('is deterministic and ignores input order', () => {
    const { tasks, members } = randomCase(42);
    const a = split(tasks, members);
    const b = split(tasks, members);
    expect(a).toEqual(b);
    const c = split([...tasks].reverse(), [...members].reverse());
    expect(c).toEqual(a);
  });

  it('is never worse than plain greedy across seeded random inputs', () => {
    let strictlyBetter = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const { tasks, members } = randomCase(seed);
      const r = split(tasks, members);
      const g = greedyGap(tasks, members);
      expect(r.maxGap, `seed ${seed}`).toBeLessThanOrEqual(g);
      if (r.maxGap < g) strictlyBetter++;
      checkInvariants(tasks, members, r);
    }
    expect(strictlyBetter).toBeGreaterThan(0);
  });

  it('keeps invariants with random locks and forbidden pairs', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { tasks, members } = randomCase(seed + 1000);
      const r0 = rng(seed);
      const locked: Record<number, number> = {};
      const forbidden: { task_id: number; member_id: number }[] = [];
      for (const t of tasks) {
        const m = members[Math.floor(r0() * members.length)]!.id;
        if (r0() < 0.15) locked[t.id] = m;
        else if (r0() < 0.3) forbidden.push({ task_id: t.id, member_id: m });
      }
      const r = split(tasks, members, { locked, forbidden });
      for (const [t, m] of Object.entries(locked)) expect(r.assignments[Number(t)]).toBe(m);
      for (const f of forbidden) {
        // A task forbidden for every member falls back to anyone, so only check the satisfiable ones.
        const blocked = forbidden.filter((g) => g.task_id === f.task_id).length;
        if (blocked < members.length) expect(r.assignments[f.task_id]).not.toBe(f.member_id);
      }
      checkInvariants(tasks, members, r);
    }
  });
});

describe('split plateaus', () => {
  it('escapes the 11/10/10/10/8 plateau around a locked task', () => {
    const efforts = [3, 2, 5, 3, 5, 3, 5, 8, 3, 5, 2, 2, 3];
    const tasks = efforts.map((effort, i) => ({ id: i + 1, effort, skill_tags: [] }));
    const members = [1, 2, 3, 4, 5].map((id) => ({ id, skills: [], weak_areas: [] }));
    const r = split(tasks, members, { locked: { 12: 5 }, forbidden: [{ task_id: 12, member_id: 1 }] });
    expect(r.maxGap).toBe(1);
    expect(r.assignments[12]).toBe(5);
  });
});

describe('split with calendar load', () => {
  it('gives the extra point to the less loaded member when gaps tie', () => {
    const tasks = [task(1, 3), task(2, 2), task(3, 2)];
    const members = [member(1), member(2)];
    expect(split(tasks, members, {}, { load: { 1: 10, 2: 0 } }).totals).toEqual({ 1: 3, 2: 4 });
    expect(split(tasks, members, {}, { load: { 1: 0, 2: 10 } }).totals).toEqual({ 1: 4, 2: 3 });
  });

  it('never trades skill fit for load', () => {
    const tasks = [task(1, 3, ['coding']), task(2, 3)];
    const members = [member(1, ['coding']), member(2)];
    const r = split(tasks, members, {}, { load: { 1: 50 } });
    expect(r.assignments[1]).toBe(1);
  });

  it('is identical to no load when load is missing, empty, or all zero', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { tasks, members } = randomCase(seed + 5000);
      const base = split(tasks, members);
      expect(split(tasks, members, {}, undefined)).toEqual(base);
      expect(split(tasks, members, {}, {})).toEqual(base);
      expect(split(tasks, members, {}, { load: {} })).toEqual(base);
      expect(split(tasks, members, {}, { load: Object.fromEntries(members.map((m) => [m.id, 0])) })).toEqual(base);
    }
  });

  it('never makes max gap or skill fit worse across seeded random inputs', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const { tasks, members } = randomCase(seed + 9000);
      const r0 = rng(seed);
      const load = Object.fromEntries(members.map((m) => [m.id, Math.floor(r0() * 12)]));
      const base = split(tasks, members);
      const withLoad = split(tasks, members, {}, { load });
      checkInvariants(tasks, members, withLoad);
      expect(withLoad.maxGap).toBeLessThanOrEqual(base.maxGap);
      const fitOf = (a: Record<number, number>) =>
        tasks.reduce((s, t) => s + skillFit(t, members.find((m) => m.id === a[t.id])!), 0);
      if (withLoad.maxGap === base.maxGap) expect(fitOf(withLoad.assignments)).toBeGreaterThanOrEqual(fitOf(base.assignments));
    }
  });

  it('respects locks and forbidden pairs with load', () => {
    const tasks = [task(1, 5), task(2, 3), task(3, 2), task(4, 2)];
    const members = [member(1), member(2), member(3)];
    const r = split(tasks, members, { locked: { 1: 2 }, forbidden: [{ task_id: 2, member_id: 3 }] }, { load: { 3: 9 } });
    expect(r.assignments[1]).toBe(2);
    expect(r.assignments[2]).not.toBe(3);
    checkInvariants(tasks, members, r);
  });
});
