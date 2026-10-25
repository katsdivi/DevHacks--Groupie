import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from './db/index.ts';
import { groupContext, memberContext, weekAheadText } from './context.ts';
import type { Member } from './db/schema.ts';
import { getGroup } from './groups.ts';
import { bot } from './bot/core.ts';
import { runCheckin } from './bot/checkin.ts';
import { buildQaMessages } from './bot/qa.ts';

const now = new Date('2026-10-26T17:00:00Z'); // Mon 10 AM Phoenix
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
const created = now.toISOString();

const G = -1001;
const OTHER = -1002;
db.insert(schema.groups)
  .values([
    { id: G, title: 'CSE 340 team', tz: 'America/Phoenix', createdAt: created, canvasCourse: 'CSE 340: Software Engineering' },
    { id: OTHER, title: 'History team', tz: 'America/Phoenix', createdAt: created },
  ])
  .run();
const add = (groupId: number, tgUserId: number | null, name: string): Member =>
  db.insert(schema.members).values({ groupId, tgUserId, name, color: '#FF6B5B', createdAt: created }).returning().get();
const divyam = add(G, 11, 'Divyam');
const ava = add(G, 12, 'Ava');
add(G, null, 'Seed');
const otherDivyam = add(OTHER, 11, 'Divyam');

let uid = 0;
const ev = (tg: number, course: string | null, title: string, dueAt: string, shared?: string) =>
  db
    .insert(schema.calendarEvents)
    .values({ telegramUserId: tg, uid: shared ?? `u${++uid}`, course, title, dueAt, kind: 'assignment', updatedAt: created })
    .run();
// Divyam: group course, another course, a removed item, one far out.
ev(11, 'CSE 340 (Fall 2026)', 'Homework 5: Testing', inDays(1), 'hw5');
ev(11, 'HST 101 (Fall 2026)', 'Essay 2 draft', inDays(2));
ev(11, 'HST 101 (Fall 2026)', 'Reading response 6', inDays(3));
ev(11, 'MAT 265 (Fall 2026)', 'Calc quiz', inDays(4));
ev(11, 'CSE 340 (Fall 2026)', 'Project 2: Campus Food Finder', inDays(25));
// Ava: the same homework (same Canvas uid) and a private item of her own.
ev(12, 'CSE 340 (Fall 2026)', 'Homework 5: Testing', inDays(1), 'hw5');
ev(12, 'PSY 101 (Fall 2026)', 'Ava private lab', inDays(2));
ev(12, 'CSE 340 (Fall 2026)', 'Quiz 3', inDays(10));
// Not in the group at all.
ev(99, 'CSE 340 (Fall 2026)', 'Stranger homework', inDays(1));
db.update(schema.calendarEvents).set({ removedAt: created }).where(eq(schema.calendarEvents.title, 'Quiz 3')).run();
ev(12, 'CSE 340 (Fall 2026)', 'Quiz 4', inDays(10));

describe('groupContext Canvas section', () => {
  const out = groupContext(G, now);
  it('lists this course only, once per item, with owners and local due time', () => {
    expect(out).toContain('Coming up (from Canvas, CSE 340: Software Engineering, next 14 days):');
    expect(out).toContain('- Tue, Oct 27, 10:00 AM: Homework 5: Testing (on the calendar of: Divyam, Ava)');
    expect(out.match(/Homework 5/g)).toHaveLength(1);
    expect(out).toContain('Quiz 4 (on the calendar of: Ava)');
  });
  it('never leaks other courses, removed items, far items, or non-members', () => {
    for (const hidden of ['Essay 2', 'Reading response', 'Calc quiz', 'HST', 'MAT 265', 'Ava private lab', 'PSY', 'Quiz 3', 'Project 2', 'Stranger']) {
      expect(out).not.toContain(hidden);
    }
  });
  it('adds nothing when the group has no Canvas course', () => {
    const plain = groupContext(OTHER, now);
    expect(plain).not.toContain('Coming up');
    expect(plain).not.toContain('Homework 5');
  });
});

describe('memberContext Canvas items', () => {
  it("shows a user's own items across all courses", () => {
    const mine = memberContext(divyam, G, now);
    for (const t of ['Homework 5: Testing', 'Essay 2 draft', 'Reading response 6', 'Calc quiz']) expect(mine).toContain(t);
    expect(mine).toContain('[HST 101 (Fall 2026)]');
    expect(mine).not.toContain('Project 2'); // more than 14 days out
    // Same person in another group still sees their own items.
    expect(memberContext(otherDivyam, OTHER, now)).toContain('Essay 2 draft');
  });
  it("never shows someone else's private items", () => {
    const avas = memberContext(ava, G, now);
    expect(avas).toContain('Ava private lab');
    for (const t of ['Essay 2', 'Reading response', 'Calc quiz', 'Stranger']) expect(avas).not.toContain(t);
    expect(memberContext(divyam, G, now)).not.toContain('Ava private lab');
  });
});

describe('weekAheadText', () => {
  it("lists this week's course items and nothing about other courses, not even counts", () => {
    const out = weekAheadText(G, now);
    expect(out).toBe('<b>Due this week:</b> Homework 5: Testing (Tue)');
    expect(out).not.toMatch(/\bother\b/);
  });
  it('is empty without a Canvas course', () => {
    expect(weekAheadText(OTHER, now)).toBe('');
  });
});

const HIDDEN = ['HST', 'MAT 265', 'PSY', 'Essay', 'Reading response', 'Calc quiz', 'private lab'];
const COUNTS = /\d+\s+other\b|\d+\s+(things?|items?|assignments?)\s+due|\d+\s*due\b/i;

describe('group views never leak other courses', () => {
  it('groupContext has no other-course names or counts', () => {
    const out = groupContext(G, now);
    for (const h of HIDDEN) expect(out).not.toContain(h);
    expect(out).not.toMatch(COUNTS);
  });

  it('runCheckin posts only this course, with no per-member counts', async () => {
    db.insert(schema.tasks).values({ groupId: G, title: 'Write tests', effort: 3, assigneeMemberId: divyam.id }).run();
    const sent: string[] = [];
    const spy = vi.spyOn(bot.api, 'sendMessage').mockImplementation(async (_chat, text) => {
      sent.push(text);
      return {} as never;
    });
    try {
      await runCheckin(G);
    } finally {
      spy.mockRestore();
    }
    const all = sent.join('\n');
    expect(all).toContain('Due this week:</b> Homework 5: Testing');
    for (const h of HIDDEN) expect(all).not.toContain(h);
    expect(all).not.toMatch(COUNTS);
    expect(all).not.toMatch(/has \d+/);
  });

  it('the group Q&A facts block has no other-course names or counts', () => {
    const messages = buildQaMessages(getGroup(G)!, 'Ava', 'what is Divyam doing this week?', now);
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    const system = messages[0]!.content;
    const facts = system.slice(system.indexOf('GROUP FACTS'));
    expect(facts).toContain('Homework 5: Testing');
    for (const h of HIDDEN) expect(facts).not.toContain(h);
    expect(facts).not.toMatch(COUNTS);
    expect(system).toContain('say you only know this project');
    expect(messages[1]!.content).toBe('Ava asks: what is Divyam doing this week?');
  });
});
