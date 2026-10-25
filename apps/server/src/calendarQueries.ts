import { and, inArray, isNull } from 'drizzle-orm';
import { db, schema } from './db/index.ts';
import type { CalendarEvent } from './db/schema.ts';

/**
 * Read-only queries over `calendar_events` (filled by the feed poller in `canvas/`).
 * Removed items (`removed_at` set) are never returned.
 */

const { calendarEvents } = schema;
const DAY_MS = 24 * 60 * 60 * 1000;
export const SOON_DAYS = 7;
/** Items due in the next 7 days count double toward load. */
const SOON_WEIGHT = 2;
/** This many items due in the next 7 days earns a "Busy week" tag. */
export const BUSY_THRESHOLD = 3;

/**
 * Normalized course code ("CSE 340") from a Canvas feed bracket ("CSE 340 (Fall 2026)")
 * or an import name ("CSE 340: Software Engineering", "cse340"). Null if there is none.
 */
export function courseCode(s: string | null | undefined): string | null {
  const m = /\b([A-Z]{2,4})\s*-?\s*(\d{3,4}[A-Z]?)\b/i.exec(s ?? '');
  return m ? `${m[1]!.toUpperCase()} ${m[2]!.toUpperCase()}` : null;
}

/** Same course: by code when both have one, else by trimmed case-insensitive name. Empty never matches. */
export function sameCourse(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  const ca = courseCode(a);
  const cb = courseCode(b);
  if (ca && cb) return ca === cb;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Live rows for these users due in [from, to), soonest first. Dates are compared parsed, not as strings. */
function liveEvents(tgUserIds: number[], from: Date, to: Date): CalendarEvent[] {
  const ids = [...new Set(tgUserIds)];
  if (!ids.length) return [];
  const lo = from.getTime();
  const hi = to.getTime();
  return db
    .select()
    .from(calendarEvents)
    .where(and(inArray(calendarEvents.telegramUserId, ids), isNull(calendarEvents.removedAt)))
    .all()
    .map((e) => ({ e, t: Date.parse(e.dueAt) }))
    .filter(({ t }) => Number.isFinite(t) && t >= lo && t < hi)
    .sort((a, b) => a.t - b.t || a.e.id - b.e.id)
    .map(({ e }) => e);
}

/** One user's own items across all their courses. Private: only for that user's own chat. */
export function upcomingForUser(tgUserId: number, from: Date, to: Date, limit = 15): CalendarEvent[] {
  return liveEvents([tgUserId], from, to).slice(0, limit);
}

/** Items of these users that belong to `course` only. Items from other courses are dropped here. */
export function eventsForMembersInCourse(tgUserIds: number[], course: string | null, from: Date, to: Date): CalendarEvent[] {
  if (!course) return [];
  return liveEvents(tgUserIds, from, to).filter((e) => sameCourse(e.course, course));
}

/** Per user count of items due in [from, to) that are NOT in `course`. Counts only, never titles. */
export function otherCourseCounts(tgUserIds: number[], course: string | null, from: Date, to: Date): Record<number, number> {
  const out: Record<number, number> = {};
  for (const id of tgUserIds) out[id] = 0;
  for (const e of liveEvents(tgUserIds, from, to)) if (!sameCourse(e.course, course)) out[e.telegramUserId]!++;
  return out;
}

export type LoadScore = { score: number; dueSoon: number };

/**
 * Calendar load per user over the project window [now, until): 1 per item, 2 if due in the next 7 days.
 * `dueSoon` counts items due in the next 7 days even past `until` (for the busy tag). Every requested user gets an entry.
 */
export function loadScores(tgUserIds: number[], now: Date, until: Date): Record<number, LoadScore> {
  const soon = now.getTime() + SOON_DAYS * DAY_MS;
  const end = new Date(Math.max(until.getTime(), soon));
  const out: Record<number, LoadScore> = {};
  for (const id of tgUserIds) out[id] = { score: 0, dueSoon: 0 };
  for (const e of liveEvents(tgUserIds, now, end)) {
    const t = Date.parse(e.dueAt);
    const s = out[e.telegramUserId]!;
    if (t < soon) s.dueSoon++;
    if (t < until.getTime()) s.score += t < soon ? SOON_WEIGHT : 1;
  }
  return out;
}

/** End of the project window: the end of the group's due day (padded to cover UTC-12) if still ahead, else 14 days out. */
export function projectWindowEnd(dueDate: string | null, now: Date): Date {
  const fallback = new Date(now.getTime() + 14 * DAY_MS);
  if (!dueDate) return fallback;
  const due = Date.parse(`${dueDate.slice(0, 10)}T23:59:59Z`) + DAY_MS / 2;
  return Number.isFinite(due) && due > now.getTime() ? new Date(due) : fallback;
}

export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);
