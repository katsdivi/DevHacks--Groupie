import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db, schema } from './db/index.ts';
import type { UserPrefs } from './db/schema.ts';
import { env } from './env.ts';
import { courseCode, upcomingForUser } from './calendarQueries.ts';
import { isForbidden, isValidTz, markCannotDm } from './prefs.ts';

/**
 * Step 18a: per-user reminder DMs. Every run, for each user with reminders on and a working DM,
 * collect their own upcoming items, pick the (item, offset) pairs that are due and not yet sent,
 * and send ONE batched message. Nothing about other people's items is ever included.
 */

const HOUR_MS = 60 * 60 * 1000;
const { userPrefs, remindersSent, members, groups, tasks } = schema;

export type ReminderItem = { key: string; title: string; context: string | null; due: Date };
export type ReminderDeps = { send: (userId: number, text: string) => Promise<unknown> };
export type ReminderRun = { users: number; sent: number; skippedQuiet: number; failed: number };

/** True when `now` falls inside the user's quiet window (local time; may wrap midnight). Equal start and end means no quiet hours. */
export function inQuietHours(now: Date, tz: string, start: string, end: string): boolean {
  if (start === end) return false;
  const local = DateTime.fromJSDate(now).setZone(tz).toFormat('HH:mm');
  return start < end ? local >= start && local < end : local >= start || local < end;
}

/** A group or task due date (YYYY-MM-DD, optionally with a time) as an instant in the group's zone. Date only means 23:59 local. */
export function dueInstant(dueDate: string, tz: string): Date | null {
  const hasTime = dueDate.length > 10 && dueDate.includes('T');
  let dt = DateTime.fromISO(hasTime ? dueDate : dueDate.slice(0, 10), { zone: tz });
  if (!dt.isValid) return null;
  if (!hasTime) dt = dt.set({ hour: 23, minute: 59, second: 0, millisecond: 0 });
  return dt.toJSDate();
}

/** This user's own upcoming items due in [now, until), keyed so the same thing appears once. */
export function collectItems(userId: number, now: Date, until: Date): ReminderItem[] {
  const out = new Map<string, ReminderItem>();
  const add = (item: ReminderItem) => {
    const t = item.due.getTime();
    if (t >= now.getTime() && t < until.getTime() && !out.has(item.key)) out.set(item.key, item);
  };

  for (const e of upcomingForUser(userId, now, until, 500)) {
    add({ key: `cal:${e.uid}`, title: e.title, context: courseCode(e.course) ?? e.course, due: new Date(e.dueAt) });
  }

  const mine = db
    .select()
    .from(members)
    .where(and(eq(members.tgUserId, userId), eq(members.isSeed, false)))
    .all();
  if (!mine.length) return [...out.values()];
  const groupRows = db.select().from(groups).where(inArray(groups.id, [...new Set(mine.map((m) => m.groupId))])).all();
  const byId = new Map(groupRows.map((g) => [g.id, g]));
  const groupLabel = (g: (typeof groupRows)[number]) => courseCode(g.canvasCourse) ?? (g.title || null);

  for (const g of groupRows) {
    if (!g.dueDate) continue;
    const due = dueInstant(g.dueDate, g.tz);
    if (due) add({ key: `assign:${g.id}`, title: g.assignmentTitle || 'Group project', context: groupLabel(g), due });
  }

  const myTasks = db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.assigneeMemberId, mine.map((m) => m.id)), ne(tasks.status, 'done'), isNotNull(tasks.dueDate)))
    .all();
  // A task due at the same moment as its group's assignment folds into that one line ("your part: ...").
  const folded = new Map<number, string[]>();
  for (const t of myTasks) {
    const g = byId.get(t.groupId);
    if (!g) continue;
    const due = dueInstant(t.dueDate!, g.tz);
    if (!due) continue;
    const assignment = out.get(`assign:${g.id}`);
    if (assignment && assignment.due.getTime() === due.getTime()) {
      folded.set(g.id, [...(folded.get(g.id) ?? []), t.title]);
      continue;
    }
    add({ key: `task:${t.id}`, title: t.title, context: g.title || null, due });
  }
  for (const [groupId, titles] of folded) {
    const item = out.get(`assign:${groupId}`)!;
    item.context = `${item.context ? `${item.context} · ` : ''}your part: ${titles.join(', ')}`;
  }
  return [...out.values()];
}

/** "in 24 h", or minutes when under an hour. */
function inLabel(ms: number): string {
  if (ms < HOUR_MS) return `in ${Math.max(1, Math.round(ms / 60000))} min`;
  return `in ${Math.round(ms / HOUR_MS)} h`;
}

/** The batched DM text. Plain text, so titles with markup characters are safe. */
export function formatReminder(items: ReminderItem[], now: Date, tz: string): string {
  const sorted = [...items].sort((a, b) => a.due.getTime() - b.due.getTime() || a.key.localeCompare(b.key));
  const head = `Heads up: ${sorted.length} ${sorted.length === 1 ? 'thing' : 'things'} due soon`;
  const lines = sorted.map((i) => {
    const when = DateTime.fromJSDate(i.due).setZone(tz).toFormat('ccc h:mm a');
    const what = i.context ? `${i.title} (${i.context})` : i.title;
    return `${when}: ${what}, ${inLabel(i.due.getTime() - now.getTime())}`;
  });
  return [head, '', ...lines, '', 'Change reminders in Settings.'].join('\n');
}

function sentKeys(userId: number): Set<string> {
  return new Set(
    db
      .select()
      .from(remindersSent)
      .where(eq(remindersSent.telegramUserId, userId))
      .all()
      .map((r) => `${r.itemKey}|${r.offsetH}`),
  );
}

/** Items with at least one offset due now and not yet sent, with every such offset. */
function dueForUser(p: UserPrefs, now: Date): { item: ReminderItem; offsets: number[] }[] {
  const offsets = p.reminderOffsets.filter((o) => Number.isFinite(o) && o > 0);
  if (!offsets.length) return [];
  const until = new Date(now.getTime() + (Math.max(...offsets) + 1) * HOUR_MS);
  const sent = sentKeys(p.telegramUserId);
  const out: { item: ReminderItem; offsets: number[] }[] = [];
  for (const item of collectItems(p.telegramUserId, now, until)) {
    const due = item.due.getTime();
    const hits = offsets.filter((o) => now.getTime() >= due - o * HOUR_MS && now.getTime() < due && !sent.has(`${item.key}|${o}`));
    if (hits.length) out.push({ item, offsets: hits });
  }
  return out;
}

/** One pass over every user. `now` is the only clock used, so tests can drive it. */
export async function runReminders(now: Date, deps: ReminderDeps): Promise<ReminderRun> {
  const run: ReminderRun = { users: 0, sent: 0, skippedQuiet: 0, failed: 0 };
  const users = db
    .select()
    .from(userPrefs)
    .where(and(eq(userPrefs.remindersEnabled, true), eq(userPrefs.canDm, true)))
    .all();
  for (const p of users) {
    run.users++;
    const tz = isValidTz(p.tz) ? p.tz : env.defaultTz;
    if (inQuietHours(now, tz, p.quietStart, p.quietEnd)) {
      run.skippedQuiet++;
      continue;
    }
    const due = dueForUser(p, now);
    if (!due.length) continue;
    const text = formatReminder(
      due.map((d) => d.item),
      now,
      tz,
    );
    try {
      await deps.send(p.telegramUserId, text);
    } catch (err) {
      run.failed++;
      if (isForbidden(err)) markCannotDm(p.telegramUserId);
      else console.error('reminder DM failed', p.telegramUserId, err);
      continue;
    }
    const sentAt = now.toISOString();
    db.transaction((tx) => {
      for (const d of due) {
        for (const o of d.offsets) {
          tx.insert(remindersSent)
            .values({ telegramUserId: p.telegramUserId, itemKey: d.item.key, offsetH: o, sentAt })
            .onConflictDoNothing()
            .run();
        }
      }
    });
    run.sent++;
  }
  return run;
}

/** Starts the 15 minute reminder loop (off when the bot is off). Returns the timer. */
export function startReminderScheduler(
  intervalMs = 15 * 60 * 1000,
  deps?: Partial<ReminderDeps> & { clock?: () => Date },
): NodeJS.Timeout | null {
  if (!deps?.send && (env.botMode === 'off' || !env.botToken)) return null;
  const clock = deps?.clock ?? (() => new Date());
  const send =
    deps?.send ??
    (async (userId: number, text: string) => {
      const { bot } = await import('./bot/core.ts');
      return bot.api.sendMessage(userId, text);
    });
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runReminders(clock(), { send });
    } catch (err) {
      console.error('reminder run failed', err);
    } finally {
      running = false;
    }
  };
  return setInterval(() => void tick(), intervalMs);
}
