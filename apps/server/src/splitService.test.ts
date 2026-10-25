import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { split } from '@groupie/shared';
import { db, schema } from './db/index.ts';
import { env } from './env.ts';
import {
  adjustedMembers,
  busyLabels,
  computeSplit,
  computeSplitWithBaseline,
  fewerPointsThanBaseline,
  memberLoads,
  splitCardData,
  splitView,
} from './splitService.ts';
import { adjustmentLine, splitCardHtml } from './cards/splitCard.ts';

const created = new Date().toISOString();
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

/** A group with 13 points of tasks (best split 5/5/3) and the given members. */
function makeGroup(id: number, people: { tg: number | null; name: string; share?: boolean }[]) {
  db.insert(schema.groups).values({ id, title: 'Team', tz: 'America/Phoenix', createdAt: created, assignmentTitle: 'Project 2' }).run();
  const members = people.map((p) =>
    db
      .insert(schema.members)
      .values({ groupId: id, tgUserId: p.tg, name: p.name, color: '#FFB547', shareWorkload: p.share ?? false, createdAt: created })
      .returning()
      .get(),
  );
  for (const [title, effort] of [['A', 3], ['B', 2], ['C', 2], ['D', 3], ['E', 3]] as const) {
    db.insert(schema.tasks).values({ groupId: id, title, effort }).run();
  }
  return members;
}

let uid = 0;
/** Four "HST 101" items in the next 4 days: a busy week from another course. */
function heavyCalendar(tg: number) {
  for (const d of [1, 2, 3, 4]) {
    db.insert(schema.calendarEvents)
      .values({ telegramUserId: tg, uid: `h${++uid}`, course: 'HST 101 (Fall 2026)', title: `History reading ${d}`, dueAt: inDays(d), kind: 'assignment', updatedAt: created })
      .run();
  }
}

// G: the first member opted in with a heavy calendar; the split would otherwise give them 5.
const G = -2001;
const [divyam] = makeGroup(G, [
  { tg: 21, name: 'Divyam', share: true },
  { tg: 23, name: 'Ava' },
  { tg: 24, name: 'Jay' },
]);
heavyCalendar(21);
heavyCalendar(23); // Ava is just as busy but did not opt in.

// QUIET: same heavy calendars, nobody opted in.
const QUIET = -2002;
makeGroup(QUIET, [
  { tg: 31, name: 'Ava' },
  { tg: 32, name: 'Jay' },
  { tg: 33, name: 'Divyam' },
]);
heavyCalendar(31);
heavyCalendar(33);

/** Saves assignees directly (the real applySplit also touches votes and status). */
const persist = (assignments: Record<number, number>) => {
  for (const [taskId, memberId] of Object.entries(assignments)) {
    db.update(schema.tasks).set({ assigneeMemberId: memberId }).where(eq(schema.tasks.id, Number(taskId))).run();
  }
};

afterEach(() => {
  env.loadAwareSplit = false;
});

describe('opt-in load', () => {
  it('reads calendars only for opted-in members, and only with the flag on', () => {
    expect(memberLoads(G)).toEqual({});
    env.loadAwareSplit = true;
    expect(memberLoads(G)).toEqual({ [divyam!.id]: { score: 8, dueSoon: 4 } });
    expect(memberLoads(QUIET)).toEqual({});
  });

  it('gives the light share to the opted-in busy member and keeps the balance', () => {
    const off = computeSplit(G);
    expect(off.totals[divyam!.id]).toBe(5);
    env.loadAwareSplit = true;
    const on = computeSplitWithBaseline(G);
    expect(on.baseline).toEqual(off);
    expect(on.result.maxGap).toBeLessThanOrEqual(off.maxGap);
    expect(on.result.totals[divyam!.id]).toBe(3);
    expect(Object.values(on.result.totals).sort()).toEqual([3, 5, 5]);
    expect(on.adjusted).toEqual([divyam!.id]);
  });

  it('is byte-identical to the no-load split when nobody opted in', () => {
    const off = JSON.stringify(computeSplit(QUIET));
    const plain = JSON.stringify(
      split(
        db.select().from(schema.tasks).all().filter((t) => t.groupId === QUIET).map((t) => ({ id: t.id, effort: t.effort, skill_tags: t.skillTags })),
        db.select().from(schema.members).all().filter((m) => m.groupId === QUIET).map((m) => ({ id: m.id, skills: m.skills, weak_areas: m.weakAreas })),
      ),
    );
    env.loadAwareSplit = true;
    const on = computeSplitWithBaseline(QUIET);
    expect(JSON.stringify(on.result)).toBe(off);
    expect(off).toBe(plain);
    expect(on.adjusted).toEqual([]);
    expect(busyLabels(QUIET)).toEqual({});
  });
});

describe('pure helpers', () => {
  it('finds members who got fewer points than the baseline', () => {
    const base = { assignments: {}, totals: { 1: 5, 2: 5, 3: 3 }, maxGap: 2 };
    expect(fewerPointsThanBaseline(base, { assignments: {}, totals: { 1: 3, 2: 5, 3: 5 }, maxGap: 2 })).toEqual([1]);
    expect(fewerPointsThanBaseline(base, base)).toEqual([]);
  });
  it('joins names naturally', () => {
    expect(adjustmentLine([])).toBe('');
    expect(adjustmentLine(['Divyam'])).toBe('Divyam got fewer points this time: busy week.');
    expect(adjustmentLine(['Divyam', 'Ava'])).toBe('Divyam and Ava got fewer points this time: busy week.');
    expect(adjustmentLine(['Divyam', 'Ava', 'Jay'])).toBe('Divyam, Ava and Jay got fewer points this time: busy week.');
  });
});

describe('split card privacy', () => {
  it('tags only the opted-in member with a bare "Busy week" and explains the adjustment', () => {
    env.loadAwareSplit = true;
    persist(computeSplit(G).assignments);
    const view = splitView(G, null);
    const data = splitCardData(view);
    expect(data.members.find((m) => m.name === 'Divyam')?.busyLabel).toBe('Busy week');
    expect(data.members.find((m) => m.name === 'Ava')?.busyLabel).toBeUndefined();
    expect(data.note).toBe('Divyam got fewer points this time: busy week.');
    // Drop the inlined font so base64 noise cannot match.
    const html = splitCardHtml(data).replace(/<style>[\s\S]*?<\/style>/, '');
    expect(html).toContain('<span class="busy"><i></i>Busy week</span>');
    expect(html).toContain('Divyam got fewer points this time: busy week.');
    expect(html).not.toMatch(/\d+\s*due/i);
    expect(html).not.toMatch(/Busy week\s*·/);
    for (const hidden of ['HST 101', 'History reading', 'Fall 2026']) expect(html).not.toContain(hidden);
  });

  it('drops the note once the shown split no longer matches the load-aware one', () => {
    env.loadAwareSplit = true;
    const base = computeSplitWithBaseline(G).baseline;
    expect(adjustedMembers(splitView(G, null, base))).toEqual([]);
  });

  it('shows no tag and no note with the flag off', () => {
    const data = splitCardData(splitView(G, null));
    expect(data.members.some((m) => m.busyLabel)).toBe(false);
    expect(data.note).toBeUndefined();
    expect(splitCardHtml(data)).not.toContain('fewer points');
  });

  it('never tags or adjusts a busy member who did not opt in', () => {
    env.loadAwareSplit = true;
    persist(computeSplit(QUIET).assignments);
    const data = splitCardData(splitView(QUIET, null));
    expect(data.members.some((m) => m.busyLabel)).toBe(false);
    expect(data.note).toBeUndefined();
    const html = splitCardHtml(data).replace(/<style>[\s\S]*?<\/style>/, '');
    expect(html).not.toContain('Busy week');
    expect(html).not.toContain('HST 101');
  });

  it('keeps counts and courses out of the split view', () => {
    env.loadAwareSplit = true;
    const json = JSON.stringify(splitView(G, null));
    expect(json).not.toMatch(/\d+\s*due/i);
    for (const hidden of ['HST 101', 'History', 'busy', 'Busy']) expect(json).not.toContain(hidden);
  });
});
