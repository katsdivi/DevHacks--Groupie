import { beforeEach, describe, expect, it } from 'vitest';
import { eq, like, type SQL } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { ParsedAssignment } from '@groupie/shared';
import { db, schema } from '../db/index.ts';
import { seedGroup } from './seed.ts';
import { demoUidPrefix, resetGroup } from './reset.ts';
import { DEMO_TASKS } from './fixture.ts';
import { PRESENTER, REAL2, testConfig } from './testConfig.ts';

const G = -100_501;
const OTHER = -100_502;
const NOW = new Date('2026-10-24T17:00:00.000Z');
const T = schema;

const count = (table: SQLiteTable, where?: SQL) => db.select().from(table).where(where).all().length;

/** Everything a seed writes, in a comparable shape (ids and timestamps dropped). */
function snapshot(groupId: number) {
  const members = db.select().from(T.members).where(eq(T.members.groupId, groupId)).all();
  const byId = new Map(members.map((m) => [m.id, m.name]));
  return {
    group: db.select().from(T.groups).where(eq(T.groups.id, groupId)).get(),
    members: members.map((m) => [m.name, m.tgUserId, m.color, m.isSeed, m.shareWorkload]),
    tasks: db
      .select()
      .from(T.tasks)
      .where(eq(T.tasks.groupId, groupId))
      .all()
      .map((t) => [t.title, t.effort, t.status, t.dueDate, t.assigneeMemberId ? byId.get(t.assigneeMemberId) : null]),
    events: db
      .select()
      .from(T.calendarEvents)
      .where(like(T.calendarEvents.uid, `${demoUidPrefix(groupId)}%`))
      .all()
      .map((e) => [e.telegramUserId, e.uid, e.title, e.dueAt, e.course]),
    busy: db.select().from(T.busyBlocks).all().map((b) => [b.telegramUserId, b.startAt, b.endAt, b.source]),
    availability: count(T.availability),
  };
}

beforeEach(() => {
  for (const t of [T.remindersSent, T.calendarEvents, T.busyBlocks, T.userPrefs, T.userMemory, T.calendarFeeds, T.availability, T.agentMessages, T.swapRequests, T.splitVotes, T.meetings, T.tasks, T.members, T.cubbieImports, T.cubbiePairCodes, T.groups]) {
    db.delete(t).run();
  }
  for (const id of [G, OTHER]) {
    db.insert(T.groups).values({ id, title: `Group ${id}`, nickname: 'Max', tz: 'America/Phoenix', createdAt: 'x' }).run();
  }
});

describe('demo seed', () => {
  it('the fixture task list is a valid parsed assignment', () => {
    expect(() => ParsedAssignment.parse({ assignment_title: 'x', due_date: '2026-11-03', tasks: DEMO_TASKS })).not.toThrow();
  });

  it('creates the expected rows', () => {
    const s = seedGroup(G, testConfig(), { now: NOW });
    expect(s).toMatchObject({ status: 'split_ready', teamSize: 4, tasks: DEMO_TASKS.length, waitingToJoin: [] });
    const g = db.select().from(T.groups).where(eq(T.groups.id, G)).get()!;
    expect(g).toMatchObject({ nickname: 'Motu', teamSize: 4, assignmentTitle: 'Project 2: Campus Food Finder', dueDate: '2026-11-03', canvasCourse: 'CSE 340: Software Engineering' });

    const members = db.select().from(T.members).where(eq(T.members.groupId, G)).all();
    expect(members.map((m) => m.name)).toEqual(['Divyam', 'Ava', 'Sam', 'Jay']);
    expect(new Set(members.map((m) => m.color)).size).toBe(4);
    expect(members.filter((m) => m.isSeed).map((m) => m.name)).toEqual(['Ava', 'Jay']);
    expect(members.find((m) => m.name === 'Divyam')!.shareWorkload).toBe(true);

    const tasks = db.select().from(T.tasks).where(eq(T.tasks.groupId, G)).all();
    expect(tasks.every((t) => t.assigneeMemberId !== null)).toBe(true);
    expect(tasks.filter((t) => t.status === 'stuck')).toHaveLength(1);

    for (const id of [PRESENTER, REAL2]) {
      expect(db.select().from(T.userPrefs).where(eq(T.userPrefs.telegramUserId, id)).get()).toMatchObject({ canDm: true, remindersEnabled: true });
    }
    const busy = (id: number) => db.select().from(T.busyBlocks).where(eq(T.busyBlocks.telegramUserId, id)).all();
    expect(busy(PRESENTER).length).toBeGreaterThan(busy(REAL2).length);
    expect(busy(REAL2).length).toBeGreaterThan(0);
    expect([...busy(PRESENTER), ...busy(REAL2)].every((b) => b.source === 'ics')).toBe(true);

    const events = (id: number) => db.select().from(T.calendarEvents).where(eq(T.calendarEvents.telegramUserId, id)).all();
    const soon = events(PRESENTER).filter((e) => Date.parse(e.dueAt) - NOW.getTime() <= 3 * 3_600_000);
    expect(soon).toHaveLength(1);
    expect(events(PRESENTER).length).toBe(5);
    expect(events(REAL2).length).toBe(1);
    // Everything else is past the 48 h reminder window.
    for (const e of [...events(PRESENTER), ...events(REAL2)].filter((e) => !e.uid.endsWith(":soon"))) {
      expect(Date.parse(e.dueAt) - NOW.getTime()).toBeGreaterThan(49 * 3_600_000);
    }
    // Pretend teammates got painted availability.
    expect(snapshot(G).availability).toBeGreaterThan(0);
  });

  it('is idempotent', () => {
    seedGroup(G, testConfig(), { now: NOW });
    const first = snapshot(G);
    seedGroup(G, testConfig(), { now: NOW });
    expect(snapshot(G)).toEqual(first);
  });

  it('--leave-join leaves real users out and the group collecting members', () => {
    const s = seedGroup(G, testConfig(), { now: NOW, leaveJoin: true });
    expect(s.status).toBe('collecting_members');
    expect(s.waitingToJoin).toEqual(['Divyam', 'Sam']);
    const members = db.select().from(T.members).where(eq(T.members.groupId, G)).all();
    expect(members.map((m) => m.name)).toEqual(['Ava', 'Jay']);
    expect(db.select().from(T.tasks).where(eq(T.tasks.groupId, G)).all().every((t) => t.assigneeMemberId === null)).toBe(true);
  });
});

describe('demo reset', () => {
  it('wipes only that group and keeps the group row', () => {
    seedGroup(G, testConfig(), { now: NOW });
    seedGroup(OTHER, testConfig(), { now: NOW });
    const member = db.select().from(T.members).where(eq(T.members.groupId, G)).all()[0]!;
    const otherMember = db.select().from(T.members).where(eq(T.members.groupId, OTHER)).all()[0]!;
    db.insert(T.agentMessages).values([
      { memberId: member.id, role: 'user', content: 'hi', createdAt: 'x' },
      { memberId: otherMember.id, role: 'user', content: 'hi', createdAt: 'x' },
    ]).run();
    db.insert(T.userMemory).values([
      { telegramUserId: PRESENTER, key: 'gpa', value: 'shared here', source: 'chat', visibility: 'group', groupChatId: G, updatedAt: 'x' },
      { telegramUserId: PRESENTER, key: 'gpa', value: 'shared there', source: 'chat', visibility: 'group', groupChatId: OTHER, updatedAt: 'x' },
      { telegramUserId: PRESENTER, key: 'major', value: 'private', source: 'chat', visibility: 'private', updatedAt: 'x' },
    ]).run();
    db.insert(T.meetings).values([{ groupId: G, start: 'a', end: 'b' }, { groupId: OTHER, start: 'a', end: 'b' }]).run();
    db.insert(T.cubbiePairCodes).values([
      { code: 'AAAAAA', telegramUserId: PRESENTER, groupChatId: G, expiresAt: 'x', createdAt: 'x' },
      { code: 'BBBBBB', telegramUserId: PRESENTER, groupChatId: OTHER, expiresAt: 'x', createdAt: 'x' },
    ]).run();
    db.insert(T.cubbieImports).values({ telegramUserId: PRESENTER, groupChatId: G, payload: {}, createdAt: 'x' }).run();
    db.insert(T.calendarFeeds).values({ telegramUserId: PRESENTER, feedUrlEncrypted: 'enc', createdAt: 'x' }).run();
    db.insert(T.calendarEvents).values({ telegramUserId: PRESENTER, uid: 'real-canvas-1', title: 'Real thing', dueAt: NOW.toISOString(), kind: 'assignment', updatedAt: 'x' }).run();
    db.insert(T.remindersSent).values([
      { telegramUserId: PRESENTER, itemKey: `cal:${demoUidPrefix(G)}presenter:soon`, offsetH: 3, sentAt: 'x' },
      { telegramUserId: PRESENTER, itemKey: 'cal:real-canvas-1', offsetH: 3, sentAt: 'x' },
      { telegramUserId: PRESENTER, itemKey: `assign:${G}`, offsetH: 24, sentAt: 'x' },
      { telegramUserId: PRESENTER, itemKey: `assign:${OTHER}`, offsetH: 24, sentAt: 'x' },
    ]).run();
    const otherBefore = snapshot(OTHER);
    const busyBefore = count(T.busyBlocks);

    const out = resetGroup(G);
    expect(out.found).toBe(1);

    const g = db.select().from(T.groups).where(eq(T.groups.id, G)).get()!;
    expect(g).toMatchObject({ title: `Group ${G}`, nickname: 'Motu', status: 'setup', teamSize: null, assignmentTitle: null, dueDate: null, canvasCourse: null });
    expect(count(T.members, eq(T.members.groupId, G))).toBe(0);
    expect(count(T.tasks, eq(T.tasks.groupId, G))).toBe(0);
    expect(count(T.meetings, eq(T.meetings.groupId, G))).toBe(0);
    expect(count(T.agentMessages)).toBe(1);
    expect(db.select().from(T.userMemory).all().map((m) => m.value).sort()).toEqual(['private', 'shared there']);
    expect(db.select().from(T.cubbiePairCodes).all().map((c) => c.code)).toEqual(['BBBBBB']);
    expect(count(T.cubbieImports)).toBe(0);
    expect(db.select().from(T.remindersSent).all().map((r) => r.itemKey).sort()).toEqual([`assign:${OTHER}`, 'cal:real-canvas-1']);
    expect(count(T.calendarEvents, like(T.calendarEvents.uid, `${demoUidPrefix(G)}%`))).toBe(0);
    // User-level data stays.
    expect(count(T.calendarFeeds)).toBe(1);
    expect(count(T.calendarEvents, eq(T.calendarEvents.uid, 'real-canvas-1'))).toBe(1);
    expect(count(T.userPrefs)).toBe(2);
    expect(count(T.busyBlocks)).toBe(busyBefore);
    // The other group is untouched (its availability is counted globally, so compare the rest).
    const otherAfter = snapshot(OTHER);
    expect({ ...otherAfter, availability: 0 }).toEqual({ ...otherBefore, availability: 0 });
    expect(count(T.meetings, eq(T.meetings.groupId, OTHER))).toBe(1);
  });

  it('reports a missing group', () => {
    expect(resetGroup(-1).found).toBe(0);
  });
});
