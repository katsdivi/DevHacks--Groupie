import { and, asc, count, eq, gt, inArray, lt } from 'drizzle-orm';
import { db, schema } from './db/index.ts';

const { busyBlocks } = schema;

/** Where a busy block came from. Blocks never carry titles, locations, or attendees. */
export type BusySource = 'google' | 'ics' | 'canvas';

/** One busy interval, UTC ISO strings. `end` is exclusive. */
export type BusyInterval = { start: string; end: string };

/** A stored busy block as other modules read it. */
export type BusyBlockView = { startAt: string; endAt: string; source: BusySource };

/** How far ahead every source syncs. */
export const BUSY_WINDOW_DAYS = 14;
/** Hard cap per (user, source) so a huge calendar cannot flood the table. */
export const MAX_BLOCKS_PER_SOURCE = 2000;

const toIso = (d: Date | string) => new Date(d).toISOString();

/** Drops invalid or empty intervals, normalizes to `toISOString()`, sorts, and merges overlaps. */
export function normalizeIntervals(blocks: BusyInterval[]): BusyInterval[] {
  const clean = blocks
    .map((b) => ({ s: new Date(b.start).getTime(), e: new Date(b.end).getTime() }))
    .filter((b) => Number.isFinite(b.s) && Number.isFinite(b.e) && b.e > b.s)
    .sort((a, b) => a.s - b.s);
  const merged: { s: number; e: number }[] = [];
  for (const b of clean) {
    const last = merged[merged.length - 1];
    if (last && b.s <= last.e) last.e = Math.max(last.e, b.e);
    else merged.push({ ...b });
  }
  return merged.slice(0, MAX_BLOCKS_PER_SOURCE).map((b) => ({ start: new Date(b.s).toISOString(), end: new Date(b.e).toISOString() }));
}

/** Atomically replaces every block of one source for one user. Returns how many were stored. */
export function replaceBusyBlocks(telegramUserId: number, source: BusySource, blocks: BusyInterval[]): number {
  const rows = normalizeIntervals(blocks);
  db.transaction((tx) => {
    tx.delete(busyBlocks).where(and(eq(busyBlocks.telegramUserId, telegramUserId), eq(busyBlocks.source, source))).run();
    for (const b of rows) tx.insert(busyBlocks).values({ telegramUserId, startAt: b.start, endAt: b.end, source }).run();
  });
  return rows.length;
}

/** Deletes one source's blocks for a user (on disconnect). */
export function deleteBusyBlocks(telegramUserId: number, source: BusySource) {
  db.delete(busyBlocks).where(and(eq(busyBlocks.telegramUserId, telegramUserId), eq(busyBlocks.source, source))).run();
}

const overlaps = (from: Date | string, to: Date | string) => and(lt(busyBlocks.startAt, toIso(to)), gt(busyBlocks.endAt, toIso(from)));

/**
 * Stable read API for other modules (SCHED): the user's busy blocks that overlap [from, to), all
 * sources, soonest first. Times are UTC ISO strings. Never titles.
 */
export function busyBlocksFor(telegramUserId: number, from: Date | string, to: Date | string): BusyBlockView[] {
  return db
    .select({ startAt: busyBlocks.startAt, endAt: busyBlocks.endAt, source: busyBlocks.source })
    .from(busyBlocks)
    .where(and(eq(busyBlocks.telegramUserId, telegramUserId), overlaps(from, to)))
    .orderBy(asc(busyBlocks.startAt))
    .all();
}

/** Same as `busyBlocksFor` for several users at once, keyed by Telegram user id (missing users get []). */
export function busyBlocksForUsers(telegramUserIds: number[], from: Date | string, to: Date | string): Map<number, BusyBlockView[]> {
  const out = new Map<number, BusyBlockView[]>(telegramUserIds.map((id) => [id, []]));
  if (!telegramUserIds.length) return out;
  const rows = db
    .select({ id: busyBlocks.telegramUserId, startAt: busyBlocks.startAt, endAt: busyBlocks.endAt, source: busyBlocks.source })
    .from(busyBlocks)
    .where(and(inArray(busyBlocks.telegramUserId, telegramUserIds), overlaps(from, to)))
    .orderBy(asc(busyBlocks.startAt))
    .all();
  for (const { id, ...b } of rows) out.get(id)?.push(b);
  return out;
}

/** How many blocks overlap the next `BUSY_WINDOW_DAYS` days (or a given range). */
export function busyBlockCount(telegramUserId: number, from: Date = new Date(), to?: Date): number {
  const end = to ?? new Date(from.getTime() + BUSY_WINDOW_DAYS * 86_400_000);
  const row = db
    .select({ n: count() })
    .from(busyBlocks)
    .where(and(eq(busyBlocks.telegramUserId, telegramUserId), overlaps(from, end)))
    .get();
  return row?.n ?? 0;
}

/** True when the user has a Google or ICS calendar connected (Canvas alone does not count). */
export function hasCalendarConnection(telegramUserId: number): boolean {
  const { calendarConnections: c } = schema;
  return !!db.select({ k: c.kind }).from(c).where(eq(c.telegramUserId, telegramUserId)).get();
}
