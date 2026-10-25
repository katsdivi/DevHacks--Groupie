import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GrammyError } from 'grammy';
import { eq } from 'drizzle-orm';
import { db, schema } from './db/index.ts';
import { dueInstant, formatReminder, inQuietHours, runReminders, startReminderScheduler } from './reminders.ts';
import { getPrefs } from './prefs.ts';

const H = 60 * 60 * 1000;
const ME = 7001;
const MATE = 7002;
const G1 = -9101;
const G2 = -9102;
const NOW = '2026-10-01T00:00:00.000Z';

type Sent = { userId: number; text: string };
let sent: Sent[];
const send = async (userId: number, text: string) => {
  sent.push({ userId, text });
};
const run = (iso: string | Date) => runReminders(new Date(iso), { send });
const at = (base: string, deltaH: number) => new Date(Date.parse(base) + deltaH * H);

function prefs(userId: number, over: Partial<typeof schema.userPrefs.$inferInsert> = {}) {
  db.insert(schema.userPrefs)
    .values({ telegramUserId: userId, canDm: true, tz: 'America/Phoenix', updatedAt: NOW, ...over })
    .run();
}
function calItem(userId: number, uid: string, title: string, dueAt: string, extra: Partial<typeof schema.calendarEvents.$inferInsert> = {}) {
  db.insert(schema.calendarEvents)
    .values({ telegramUserId: userId, uid, title, dueAt, course: 'CSE 340 (Fall 2026)', kind: 'assignment', updatedAt: NOW, ...extra })
    .run();
}
function group(id: number, over: Partial<typeof schema.groups.$inferInsert> = {}) {
  db.insert(schema.groups).values({ id, title: `Team ${-id}`, tz: 'America/Phoenix', createdAt: NOW, status: 'active', ...over }).run();
}
function member(groupId: number, tgUserId: number) {
  return db
    .insert(schema.members)
    .values({ groupId, tgUserId, name: `U${tgUserId}`, color: '#fff', createdAt: NOW })
    .returning()
    .get().id;
}
function task(groupId: number, assignee: number, title: string, dueDate: string, status: 'todo' | 'done' = 'todo') {
  return db.insert(schema.tasks).values({ groupId, title, effort: 3, assigneeMemberId: assignee, dueDate, status }).returning().get().id;
}
const rows = (userId = ME) =>
  db
    .select()
    .from(schema.remindersSent)
    .where(eq(schema.remindersSent.telegramUserId, userId))
    .all()
    .map((r) => `${r.itemKey}|${r.offsetH}`)
    .sort();

beforeEach(() => {
  sent = [];
  for (const t of [schema.remindersSent, schema.userPrefs, schema.calendarEvents, schema.tasks, schema.members, schema.groups]) {
    db.delete(t).run();
  }
});

// Due at noon Phoenix time, so 48, 24, and 3 hours before are all outside the default quiet hours.
const DUE = '2026-11-10T19:00:00.000Z';

describe('offsets', () => {
  it('fires 48, 24, and 3 hours before, each exactly once', async () => {
    prefs(ME);
    calItem(ME, 'hw5', 'Homework 5', DUE);
    await run(at(DUE, -48 - 1 / 60));
    expect(sent).toHaveLength(0);
    await run(at(DUE, -48));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('Homework 5 (CSE 340), in 48 h');
    expect(rows()).toEqual(['cal:hw5|48']);
    await run(at(DUE, -47.75));
    await run(at(DUE, -30));
    expect(sent).toHaveLength(1);
    await run(at(DUE, -24));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toContain('in 24 h');
    await run(at(DUE, -3 - 1 / 60));
    expect(sent).toHaveLength(2);
    await run(at(DUE, -3));
    await run(at(DUE, -2));
    await run(at(DUE, 0.25));
    expect(sent).toHaveLength(3);
    expect(sent[2]!.text).toContain('in 3 h');
    expect(rows()).toEqual(['cal:hw5|24', 'cal:hw5|3', 'cal:hw5|48']);
  });

  it('records every offset already passed when an item first shows up late, but sends it once', async () => {
    prefs(ME);
    calItem(ME, 'late', 'Quiz', DUE);
    await run(at(DUE, -4)); // 08:00 local
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text.match(/Quiz/g)).toHaveLength(1);
    expect(rows()).toEqual(['cal:late|24', 'cal:late|48']);
  });

  it('skips removed calendar items and items already past due', async () => {
    prefs(ME);
    calItem(ME, 'gone', 'Gone', DUE, { removedAt: NOW });
    calItem(ME, 'past', 'Past', at(DUE, -50).toISOString());
    await run(at(DUE, -24));
    expect(sent).toHaveLength(0);
  });
});

describe('dedupe', () => {
  it('never repeats across runs or across two groups sharing a course', async () => {
    prefs(ME);
    group(G1, { canvasCourse: 'CSE 340' });
    group(G2, { canvasCourse: 'CSE 340' });
    member(G1, ME);
    member(G2, ME);
    calItem(ME, 'shared', 'Lab 2', DUE);
    for (let h = -49; h < 1; h += 0.25) await run(at(DUE, h));
    expect(sent).toHaveLength(3);
    for (const s of sent) expect(s.text.match(/Lab 2/g)).toHaveLength(1);
  });
});

describe('quiet hours', () => {
  it('defers during quiet hours, then sends once at quiet end with all due offsets recorded', async () => {
    // Due 09:00 Phoenix (16:00Z). 6 h before is 03:00 local, 3 h before is 06:00 local: both quiet (23:00 to 08:00).
    const due = '2026-11-10T16:00:00.000Z';
    prefs(ME, { reminderOffsets: [6, 3] });
    calItem(ME, 'early', 'Midterm', due);
    const r1 = await run(at(due, -6));
    await run(at(due, -3));
    await run(at(due, -1.25)); // 07:45 local, still quiet
    expect(sent).toHaveLength(0);
    expect(r1.skippedQuiet).toBe(1);
    await run(at(due, -1)); // 08:00 local
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('Midterm (CSE 340), in 1 h');
    expect(rows()).toEqual(['cal:early|3', 'cal:early|6']);
    await run(at(due, -0.75));
    expect(sent).toHaveLength(1);
  });

  it('handles windows that wrap midnight and windows that do not', () => {
    const tz = 'America/Phoenix';
    expect(inQuietHours(new Date('2026-11-10T06:30:00Z'), tz, '23:00', '08:00')).toBe(true); // 23:30
    expect(inQuietHours(new Date('2026-11-10T14:00:00Z'), tz, '23:00', '08:00')).toBe(true); // 07:00
    expect(inQuietHours(new Date('2026-11-10T15:00:00Z'), tz, '23:00', '08:00')).toBe(false); // 08:00
    expect(inQuietHours(new Date('2026-11-10T20:00:00Z'), tz, '12:00', '14:00')).toBe(true); // 13:00
    expect(inQuietHours(new Date('2026-11-10T22:00:00Z'), tz, '12:00', '14:00')).toBe(false); // 15:00
    expect(inQuietHours(new Date('2026-11-10T06:30:00Z'), tz, '00:00', '00:00')).toBe(false);
  });
});

describe('batching and privacy', () => {
  it('sends one message per user with every item, sorted by due time, and nothing of a teammate', async () => {
    prefs(ME, { quietStart: '00:00', quietEnd: '00:00' });
    prefs(MATE, { quietStart: '00:00', quietEnd: '00:00' });
    group(G1, { assignmentTitle: 'Project 1', dueDate: '2026-11-10', canvasCourse: 'CSE 340: Software Engineering' });
    const me = member(G1, ME);
    const mate = member(G1, MATE);
    task(G1, me, 'Write intro', '2026-11-10');
    task(G1, me, 'Done thing', '2026-11-10', 'done');
    task(G1, mate, 'Mate secret task', '2026-11-10');
    calItem(ME, 'hw', 'Homework 5', '2026-11-10T18:00:00.000Z');
    calItem(MATE, 'mate-hw', 'Mate private essay', '2026-11-10T18:00:00.000Z', { course: 'HIS 101' });
    // Project due 23:59 Phoenix = 06:59Z next day.
    await run('2026-11-10T00:00:00.000Z');
    const mine = sent.filter((s) => s.userId === ME);
    expect(mine).toHaveLength(1);
    const text = mine[0]!.text;
    expect(text.split('\n')).toEqual([
      'Heads up: 3 things due soon',
      '',
      'Tue 11:00 AM: Homework 5 (CSE 340), in 18 h',
      'Tue 11:59 PM: Project 1 (CSE 340), in 31 h',
      'Tue 11:59 PM: Write intro (Team 9101), in 31 h',
      '',
      'Change reminders in Settings.',
    ]);
    expect(text).not.toContain('Mate');
    expect(text).not.toContain('Done thing');
    const theirs = sent.find((s) => s.userId === MATE)!.text;
    expect(theirs).not.toContain('Homework 5');
    expect(theirs).not.toContain('Write intro');
    expect(rows()).toEqual(['assign:-9101|48', 'cal:hw|24', 'cal:hw|48', 'task:' + db.select().from(schema.tasks).all().find((t) => t.title === 'Write intro')!.id + '|48'].sort());
  });

  it('uses the singular for one item', () => {
    const text = formatReminder([{ key: 'cal:x', title: 'X', context: null, due: new Date('2026-11-10T19:00:00Z') }], new Date('2026-11-10T18:30:00Z'), 'America/Phoenix');
    expect(text.split('\n')[0]).toBe('Heads up: 1 thing due soon');
    expect(text).toContain('Tue 12:00 PM: X, in 30 min');
  });
});

describe('who gets nothing', () => {
  it('sends nothing when reminders are off or the bot cannot DM them', async () => {
    prefs(ME, { remindersEnabled: false });
    prefs(MATE, { canDm: false });
    calItem(ME, 'a', 'A', DUE);
    calItem(MATE, 'b', 'B', DUE);
    await run(at(DUE, -2));
    expect(sent).toHaveLength(0);
    expect(rows(ME)).toEqual([]);
    expect(rows(MATE)).toEqual([]);
  });

  it('marks can_dm false on a Telegram 403 and records nothing', async () => {
    prefs(ME);
    calItem(ME, 'a', 'A', DUE);
    const forbidden = new GrammyError(
      'Forbidden',
      { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' },
      'sendMessage',
      {},
    );
    const res = await runReminders(at(DUE, -2), { send: vi.fn(async () => Promise.reject(forbidden)) });
    expect(res.failed).toBe(1);
    expect(getPrefs(ME).canDm).toBe(false);
    expect(rows()).toEqual([]);
    await run(at(DUE, -1));
    expect(sent).toHaveLength(0);
  });

  it('keeps can_dm and retries next run after other errors', async () => {
    prefs(ME);
    calItem(ME, 'a', 'A', DUE);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await runReminders(at(DUE, -2), { send: async () => Promise.reject(new Error('network')) });
    expect(getPrefs(ME).canDm).toBe(true);
    expect(rows()).toEqual([]);
    await run(at(DUE, -1.5));
    expect(sent).toHaveLength(1);
    vi.restoreAllMocks();
  });
});

describe('time zones', () => {
  it('America/Phoenix has no DST: date-only dues are 23:59 at UTC-7 all year', () => {
    expect(dueInstant('2026-07-01', 'America/Phoenix')!.toISOString()).toBe('2026-07-02T06:59:00.000Z');
    expect(dueInstant('2026-12-01', 'America/Phoenix')!.toISOString()).toBe('2026-12-02T06:59:00.000Z');
  });

  it('DST zone: offsets are real hours across the fall-back change, and labels use local time', async () => {
    // US DST ends 2026-11-01 02:00 local. Due 2026-11-02 23:59 EST = 04:59Z on Nov 3.
    const due = dueInstant('2026-11-02', 'America/New_York')!;
    expect(due.toISOString()).toBe('2026-11-03T04:59:00.000Z');
    prefs(ME, { tz: 'America/New_York', quietStart: '00:00', quietEnd: '00:00', reminderOffsets: [48] });
    group(G1, { tz: 'America/New_York', assignmentTitle: 'Essay', dueDate: '2026-11-02' });
    member(G1, ME);
    await run(at(due.toISOString(), -48 - 1 / 60));
    expect(sent).toHaveLength(0);
    await run(at(due.toISOString(), -48)); // 2026-11-01T04:59Z = 00:59 EDT, before the change
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('Mon 11:59 PM: Essay (Team 9101), in 48 h');
  });

  it('quiet hours follow the local clock across DST', () => {
    const tz = 'America/New_York';
    expect(inQuietHours(new Date('2026-10-31T03:30:00Z'), tz, '23:00', '08:00')).toBe(true); // 23:30 EDT
    expect(inQuietHours(new Date('2026-11-05T03:30:00Z'), tz, '23:00', '08:00')).toBe(false); // 22:30 EST
  });
});

describe('scheduler', () => {
  it('runs on an interval with an injected clock and sender', async () => {
    vi.useFakeTimers();
    prefs(ME);
    calItem(ME, 'a', 'A', DUE);
    const timer = startReminderScheduler(1000, { send, clock: () => at(DUE, -2) })!;
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toHaveLength(1);
    clearInterval(timer);
    vi.useRealTimers();
  });

  it('stays off when the bot is off and no sender is given', () => {
    expect(startReminderScheduler()).toBeNull();
  });
});
