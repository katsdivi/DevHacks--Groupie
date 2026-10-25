import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db, schema } from '../db/index.ts';
import { getGroup, getTasks, saveAssignment, setNickname, setTeamSize, upsertGroup } from '../groups.ts';
import { listMembers, setShareWorkload, upsertMember } from '../members.ts';
import { seedAvailability } from '../availability.ts';
import { replaceBusyBlocks, type BusyInterval } from '../busy.ts';
import { applySplit, computeSplit } from '../splitService.ts';
import { getPrefs } from '../prefs.ts';
import { demoUidPrefix, resetGroup } from './reset.ts';
import { presenterOf, type DemoConfig, type DemoMember } from './config.ts';
import { BUSY_WEEK_ITEMS, DEMO_TASKS, LIGHT_ITEMS, SOON_ITEM } from './fixture.ts';

/**
 * Loads the demo team into one group: reset first (so seeding twice gives the same rows), then the
 * assignment and tasks, members with colors, reminder prefs for real users, calendar busy blocks,
 * Canvas items for this course, and one item due in 3 hours for the presenter. No LLM, no Telegram.
 */

const { groups, calendarEvents, userPrefs, tasks } = schema;

export type SeedOpts = { now?: Date; leaveJoin?: boolean };
export type SeedSummary = {
  groupId: number;
  status: string;
  teamSize: number;
  tasks: number;
  members: string[];
  waitingToJoin: string[];
  canvasItems: number;
  busyBlocks: number;
  soonItemDue: string;
};

const HOUR_MS = 3_600_000;
const realMembers = (c: DemoConfig) => c.members.filter((m): m is DemoMember & { telegramUserId: number } => m.telegramUserId !== null);

/** Busy intervals for a calendar profile, in the group's zone. Today's block counts only if it has not ended. */
function busyFor(profile: DemoMember['calendar'], tz: string, now: Date): BusyInterval[] {
  const today = DateTime.fromJSDate(now).setZone(tz).startOf('day');
  const block = (day: number, from: number, to: number) => ({
    start: today.plus({ days: day, hours: from }).toUTC().toISO()!,
    end: today.plus({ days: day, hours: to }).toUTC().toISO()!,
  });
  const out: BusyInterval[] = [];
  if (profile === 'busy-week') for (let d = 0; d < 6; d++) out.push(block(d, 13, 18));
  if (profile === 'light') out.push(block(1, 15, 17), block(3, 15, 17));
  return out.filter((b) => Date.parse(b.end) > now.getTime());
}

/** Inserts or updates one Canvas item by its stable uid. */
function upsertItem(userId: number, uid: string, title: string, course: string, dueAt: Date, now: Date) {
  const values = { title, course, dueAt: dueAt.toISOString(), kind: 'assignment' as const, removedAt: null, updatedAt: now.toISOString() };
  db.insert(calendarEvents)
    .values({ telegramUserId: userId, uid, ...values })
    .onConflictDoUpdate({ target: [calendarEvents.telegramUserId, calendarEvents.uid], set: values })
    .run();
}

/** Seeds the group from the config. The group row is created if the bot has not seen it yet. */
export function seedGroup(groupId: number, config: DemoConfig, opts: SeedOpts = {}): SeedSummary {
  const now = opts.now ?? new Date();
  const g = config.group;
  if (!getGroup(groupId)) upsertGroup(groupId, g.title);
  resetGroup(groupId);
  const group = getGroup(groupId)!;
  const tz = group.tz;

  if (g.nickname) setNickname(groupId, g.nickname);
  setTeamSize(groupId, g.teamSize);
  const due = DateTime.fromJSDate(now).setZone(tz).plus({ days: g.dueInDays }).toISODate()!;
  saveAssignment(groupId, { assignment_title: g.assignmentTitle, due_date: due, tasks: DEMO_TASKS });
  db.update(groups).set({ canvasCourse: g.course }).where(eq(groups.id, groupId)).run();

  // Presenter first so colors follow a sensible join order.
  const presenter = presenterOf(config);
  const ordered = [presenter, ...config.members.filter((m) => m !== presenter)];
  const joining = ordered.filter((m) => m.telegramUserId === null || !opts.leaveJoin);
  for (const m of joining) {
    const row = upsertMember(groupId, m.telegramUserId, { name: m.name, skills: m.skills, weak_areas: m.weakAreas }, m.telegramUserId === null);
    if (m.shareWorkload) setShareWorkload(row.id, true);
  }

  // Real users: reminders on and DMs allowed, busy blocks, and Canvas items for this course.
  const prefix = demoUidPrefix(groupId);
  const today = DateTime.fromJSDate(now).setZone(tz).startOf('day');
  let canvasItems = 0;
  let busyBlocks = 0;
  for (const m of realMembers(config)) {
    getPrefs(m.telegramUserId, now);
    db.update(userPrefs)
      .set({ canDm: true, remindersEnabled: true, updatedAt: now.toISOString() })
      .where(eq(userPrefs.telegramUserId, m.telegramUserId))
      .run();
    busyBlocks += replaceBusyBlocks(m.telegramUserId, 'ics', busyFor(m.calendar, tz, now));
    const titles = m.calendar === 'busy-week' ? BUSY_WEEK_ITEMS : m.calendar === 'light' ? LIGHT_ITEMS : [];
    titles.forEach((title, i) => {
      const dueAt = today.plus({ days: 3 + i, hours: 23, minutes: 59 }).toJSDate();
      upsertItem(m.telegramUserId, `${prefix}${m.role}:${i + 1}`, title, g.course, dueAt, now);
      canvasItems++;
    });
  }
  const soonDue = new Date(Math.floor((now.getTime() + 3 * HOUR_MS) / 60_000) * 60_000);
  upsertItem(presenter.telegramUserId!, `${prefix}${presenter.role}:soon`, SOON_ITEM, g.course, soonDue, now);
  canvasItems++;

  // Everyone joined: run the split now (no card posted) and give the team believable progress.
  const joined = listMembers(groupId);
  if (joined.length >= g.teamSize) {
    applySplit(groupId, computeSplit(groupId));
    const seeds = joined.filter((m) => m.isSeed);
    const byOwner = (memberId: number | undefined) => getTasks(groupId).find((t) => t.assigneeMemberId === memberId);
    const stuck = byOwner(seeds[0]?.id);
    const done = byOwner(seeds[1]?.id);
    if (stuck) db.update(tasks).set({ status: 'stuck' }).where(and(eq(tasks.id, stuck.id), eq(tasks.groupId, groupId))).run();
    if (done) db.update(tasks).set({ status: 'done' }).where(and(eq(tasks.id, done.id), eq(tasks.groupId, groupId))).run();
  }
  seedAvailability(groupId, now);

  const final = getGroup(groupId)!;
  const names = new Set(joined.map((m) => m.name));
  return {
    groupId,
    status: final.status,
    teamSize: g.teamSize,
    tasks: getTasks(groupId).length,
    members: joined.map((m) => `${m.name}${m.isSeed ? ' (pretend)' : ''}`),
    waitingToJoin: config.members.filter((m) => !names.has(m.name)).map((m) => m.name),
    canvasItems,
    busyBlocks,
    soonItemDue: DateTime.fromJSDate(soonDue).setZone(tz).toFormat('ccc h:mm a'),
  };
}
