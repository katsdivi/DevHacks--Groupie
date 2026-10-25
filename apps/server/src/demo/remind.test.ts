import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.ts';
import { runReminders } from '../reminders.ts';
import { seedGroup } from './seed.ts';
import { remindUser } from './remind.ts';
import { SOON_ITEM } from './fixture.ts';
import { PRESENTER, REAL2, testConfig } from './testConfig.ts';

const G = -100_601;
// 10 AM in Phoenix, outside quiet hours.
const SEEDED = new Date('2026-10-24T17:00:00.000Z');
const LATER = new Date(SEEDED.getTime() + 60_000);
const T = schema;

let sent: { userId: number; text: string }[];
const send = async (userId: number, text: string) => {
  sent.push({ userId, text });
};

beforeEach(() => {
  sent = [];
  for (const t of [T.remindersSent, T.calendarEvents, T.busyBlocks, T.userPrefs, T.availability, T.tasks, T.members, T.groups]) db.delete(t).run();
  db.insert(T.groups).values({ id: G, title: 'Demo', tz: 'America/Phoenix', createdAt: 'x' }).run();
  seedGroup(G, testConfig(), { now: SEEDED });
});

describe('demo remind', () => {
  it('sends exactly one batched message for the 3 hour item, to that user only', async () => {
    const res = await remindUser(PRESENTER, LATER, { send });
    expect(res.sent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.userId).toBe(PRESENTER);
    expect(sent[0]!.text).toContain('Heads up! 1 thing due soon:');
    expect(sent[0]!.text).toContain(SOON_ITEM);
    expect(sent[0]!.text).toContain('in 3 h');
    // REAL2 also has reminders on but was not asked for.
    expect(db.select().from(T.remindersSent).where(eq(T.remindersSent.telegramUserId, REAL2)).all()).toHaveLength(0);
    // A second run sends nothing; a reseed makes the moment repeatable.
    expect(await remindUser(PRESENTER, LATER, { send })).toEqual({ sent: false, reason: 'nothing due' });
    seedGroup(G, testConfig(), { now: SEEDED });
    expect((await remindUser(PRESENTER, LATER, { send })).sent).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it('matches what runReminders sends for the same user', async () => {
    await remindUser(PRESENTER, LATER, { send });
    const mine = sent[0]!.text;
    db.delete(T.remindersSent).run();
    sent = [];
    await runReminders(LATER, { send });
    expect(sent.find((s) => s.userId === PRESENTER)!.text).toBe(mine);
  });

  it('says why nothing was sent', async () => {
    db.update(T.userPrefs).set({ canDm: false }).where(eq(T.userPrefs.telegramUserId, PRESENTER)).run();
    expect(await remindUser(PRESENTER, LATER, { send })).toEqual({ sent: false, reason: 'cannot dm' });
    expect(await remindUser(4242, LATER, { send })).toEqual({ sent: false, reason: 'no prefs' });
    expect(sent).toHaveLength(0);
  });
});
