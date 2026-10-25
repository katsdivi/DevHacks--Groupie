import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.ts';
import { env } from '../env.ts';
import { isForbidden, isValidTz, markCannotDm } from '../prefs.ts';
import { collectItems, formatReminder, inQuietHours, type ReminderDeps, type ReminderItem } from '../reminders.ts';

/**
 * The reminder pass from reminders.ts, scoped to ONE user, run now. Same selection (offsets due and
 * not yet sent), same batched text, same reminders_sent rows. Built from reminders.ts exports so its
 * behavior is unchanged; demo/remind.test.ts checks the text matches runReminders for the same user.
 */

const HOUR_MS = 3_600_000;
const { userPrefs, remindersSent } = schema;

export type RemindResult =
  | { sent: true; text: string; items: number }
  | { sent: false; reason: 'no prefs' | 'reminders off' | 'cannot dm' | 'quiet hours' | 'nothing due' | 'send failed'; detail?: string };

/** Runs the reminder pass for one user and sends at most one batched DM. */
export async function remindUser(userId: number, now: Date, deps: ReminderDeps): Promise<RemindResult> {
  const p = db.select().from(userPrefs).where(eq(userPrefs.telegramUserId, userId)).get();
  if (!p) return { sent: false, reason: 'no prefs' };
  if (!p.remindersEnabled) return { sent: false, reason: 'reminders off' };
  if (!p.canDm) return { sent: false, reason: 'cannot dm' };
  const tz = isValidTz(p.tz) ? p.tz : env.defaultTz;
  if (inQuietHours(now, tz, p.quietStart, p.quietEnd)) return { sent: false, reason: 'quiet hours', detail: `${p.quietStart} to ${p.quietEnd} ${tz}` };

  const offsets = p.reminderOffsets.filter((o) => Number.isFinite(o) && o > 0);
  if (!offsets.length) return { sent: false, reason: 'nothing due' };
  const until = new Date(now.getTime() + (Math.max(...offsets) + 1) * HOUR_MS);
  const sent = new Set(
    db
      .select()
      .from(remindersSent)
      .where(eq(remindersSent.telegramUserId, userId))
      .all()
      .map((r) => `${r.itemKey}|${r.offsetH}`),
  );
  const due: { item: ReminderItem; offsets: number[] }[] = [];
  for (const item of collectItems(userId, now, until)) {
    const t = item.due.getTime();
    const hits = offsets.filter((o) => now.getTime() >= t - o * HOUR_MS && now.getTime() < t && !sent.has(`${item.key}|${o}`));
    if (hits.length) due.push({ item, offsets: hits });
  }
  if (!due.length) return { sent: false, reason: 'nothing due' };

  const text = formatReminder(
    due.map((d) => d.item),
    now,
    tz,
  );
  try {
    await deps.send(userId, text);
  } catch (err) {
    if (isForbidden(err)) markCannotDm(userId);
    return { sent: false, reason: 'send failed', detail: err instanceof Error ? err.message : String(err) };
  }
  const sentAt = now.toISOString();
  db.transaction((tx) => {
    for (const d of due) {
      for (const o of d.offsets) {
        tx.insert(remindersSent).values({ telegramUserId: userId, itemKey: d.item.key, offsetH: o, sentAt }).onConflictDoNothing().run();
      }
    }
  });
  return { sent: true, text, items: due.length };
}
