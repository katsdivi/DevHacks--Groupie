import { eq } from 'drizzle-orm';
import { IANAZone } from 'luxon';
import { PrefsUpdateRequest, type PrefsResponse } from '@groupie/shared';
import { db, schema } from './db/index.ts';
import type { UserPrefs } from './db/schema.ts';
import { env } from './env.ts';

/**
 * Per-user reminder prefs (`user_prefs`). Rows are created lazily with defaults.
 * `markCannotDm(userId)` is the shared hook for any code whose DM to a user fails with Telegram 403.
 */

const { userPrefs } = schema;

/** Offsets the Mini App offers (hours before due). */
export const OFFSET_CHOICES = [72, 48, 24, 12, 6, 3, 1] as const;

export const isValidTz = (tz: string) => IANAZone.isValidZone(tz);

/** t.me deep link that opens the bot DM with `/start reminders`. */
export const startLink = () => `https://t.me/${env.botUsername}?start=reminders`;

/** The user's prefs row, inserting defaults on first use. */
export function getPrefs(userId: number, now = new Date()): UserPrefs {
  const row = db.select().from(userPrefs).where(eq(userPrefs.telegramUserId, userId)).get();
  if (row) return row;
  return db
    .insert(userPrefs)
    .values({ telegramUserId: userId, tz: env.defaultTz, updatedAt: now.toISOString() })
    .onConflictDoNothing()
    .returning()
    .get() ?? db.select().from(userPrefs).where(eq(userPrefs.telegramUserId, userId)).get()!;
}

export const prefsDto = (p: UserPrefs): PrefsResponse => ({
  reminders_enabled: p.remindersEnabled,
  reminder_offsets: p.reminderOffsets,
  quiet_start: p.quietStart,
  quiet_end: p.quietEnd,
  tz: p.tz,
  can_dm: p.canDm,
  start_link: startLink(),
});

/** Records whether Telegram lets us DM this user. True after they /start the bot in a DM. */
export function setCanDm(userId: number, canDm: boolean, now = new Date()) {
  getPrefs(userId, now);
  db.update(userPrefs)
    .set({ canDm, updatedAt: now.toISOString() })
    .where(eq(userPrefs.telegramUserId, userId))
    .run();
}

/** Call when a DM to this user fails with a Telegram 403 (blocked, or never started the bot). */
export function markCannotDm(userId: number) {
  setCanDm(userId, false);
}

/** True for Telegram's "bot was blocked / can't initiate conversation" (HTTP 403). */
export function isForbidden(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { error_code?: unknown }).error_code === 403;
}

type Patch = Partial<Pick<UserPrefs, 'remindersEnabled' | 'reminderOffsets' | 'quietStart' | 'quietEnd' | 'tz'>>;

/**
 * Validates a PUT body. Offsets are deduped and sorted descending, then must be 1 to 5 values
 * of 1 to 336 hours. Unknown keys (including any user id) are dropped.
 */
export function parsePrefsUpdate(body: unknown): { ok: true; patch: Patch } | { ok: false; message: string } {
  const parsed = PrefsUpdateRequest.safeParse(body ?? {});
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check your reminder settings.' };
  const v = parsed.data;
  const patch: Patch = {};
  if (v.reminders_enabled !== undefined) patch.remindersEnabled = v.reminders_enabled;
  if (v.reminder_offsets !== undefined) {
    const offsets = [...new Set(v.reminder_offsets)].sort((a, b) => b - a);
    if (offsets.length < 1 || offsets.length > 5) return { ok: false, message: 'Pick 1 to 5 reminder times.' };
    patch.reminderOffsets = offsets;
  }
  if (v.quiet_start !== undefined) patch.quietStart = v.quiet_start;
  if (v.quiet_end !== undefined) patch.quietEnd = v.quiet_end;
  if (v.tz !== undefined) {
    if (!isValidTz(v.tz)) return { ok: false, message: 'Use a time zone name like America/Phoenix.' };
    patch.tz = v.tz;
  }
  return { ok: true, patch };
}

export function updatePrefs(userId: number, patch: Patch, now = new Date()): UserPrefs {
  getPrefs(userId, now);
  return db
    .update(userPrefs)
    .set({ ...patch, updatedAt: now.toISOString() })
    .where(eq(userPrefs.telegramUserId, userId))
    .returning()
    .get()!;
}
