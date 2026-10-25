import { and, eq, gt, lt } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { buildGrid, GRID_DAYS, SLOT_MINUTES, slotStart, type AvailabilityPrefill } from '@groupie/shared';
import { db, schema } from './db/index.ts';

const { busyBlocks, calendarConnections } = schema;
const SLOT_MS = SLOT_MINUTES * 60_000;

/** Local hours treated as reasonable when prefilling. Env overrides: PREFILL_START_HOUR, PREFILL_END_HOUR. */
export const PREFILL_HOURS = { start: 8, end: 22 };

function hourFromEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function prefillHours(vars: Record<string, string | undefined> = process.env): { start: number; end: number } {
  const start = hourFromEnv(vars.PREFILL_START_HOUR, PREFILL_HOURS.start, 0, 23);
  const end = hourFromEnv(vars.PREFILL_END_HOUR, PREFILL_HOURS.end, 1, 24);
  return end > start ? { start, end } : { ...PREFILL_HOURS };
}

type Span = { startAt: string; endAt: string };

/** Pure: the slot starts (30 minutes each) that overlap any span. Half-open, so touching edges do not count. */
export function overlapSlots(spans: Span[], slotStarts: string[]): Set<string> {
  const ranges = spans
    .map((b) => [Date.parse(b.startAt), Date.parse(b.endAt)] as const)
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s);
  const out = new Set<string>();
  for (const slot of slotStarts) {
    const s = Date.parse(slot);
    const e = s + SLOT_MS;
    if (ranges.some(([bs, be]) => bs < e && be > s)) out.add(slot);
  }
  return out;
}

function blocksBetween(tgUserId: number, fromIso: string, toIso: string): Span[] {
  return db
    .select({ startAt: busyBlocks.startAt, endAt: busyBlocks.endAt })
    .from(busyBlocks)
    .where(and(eq(busyBlocks.telegramUserId, tgUserId), gt(busyBlocks.endAt, fromIso), lt(busyBlocks.startAt, toIso)))
    .all();
}

/**
 * Read-only: which of these slot starts overlap the user's busy blocks. Never reads titles (there are none).
 * Lead: can be swapped for CAL's `busyBlocksFor` at integration.
 */
export function busySlotsFor(tgUserId: number, slotStarts: string[]): Set<string> {
  if (!slotStarts.length) return new Set();
  const sorted = [...slotStarts].sort();
  const from = new Date(Date.parse(sorted[0]!)).toISOString();
  const to = new Date(Date.parse(sorted[sorted.length - 1]!) + SLOT_MS).toISOString();
  // A day of slack on each side covers blocks stored with other ISO offsets; the JS check is exact.
  const pad = 86_400_000;
  const spans = blocksBetween(tgUserId, new Date(Date.parse(from) - pad).toISOString(), new Date(Date.parse(to) + pad).toISOString());
  return overlapSlots(spans, slotStarts);
}

export function hasCalendarConnection(tgUserId: number): boolean {
  return Boolean(db.select({ id: calendarConnections.telegramUserId }).from(calendarConnections).where(eq(calendarConnections.telegramUserId, tgUserId)).get());
}

/** Any busy block on the grid's 7 days, even outside the painted hours. */
function hasBlockInWindow(tgUserId: number, tz: string, now: Date): boolean {
  const from = DateTime.fromJSDate(now, { zone: tz }).startOf('day');
  const to = from.plus({ days: GRID_DAYS });
  return blocksBetween(tgUserId, from.toUTC().toISO()!, to.toUTC().toISO()!).length > 0;
}

/** Every grid slot id, built exactly like the web grid's cells. */
export function gridSlots(tz: string, now = new Date()): string[] {
  const grid = buildGrid(tz, now);
  return grid.days.flatMap((day) => grid.rows.map((row) => slotStart(tz, day.date, row.hour, row.minute)));
}

/**
 * The caller's own prefill, or undefined when they have no calendar data (no Telegram id, no connection,
 * and no busy block in the grid window). Only ever called for the requesting member.
 */
export function prefillFor(
  member: { tgUserId: number | null; isSeed?: boolean },
  tz: string,
  now = new Date(),
): AvailabilityPrefill | undefined {
  if (!member.tgUserId || member.isSeed) return undefined;
  const slots = gridSlots(tz, now);
  const busy = busySlotsFor(member.tgUserId, slots);
  if (!busy.size && !hasCalendarConnection(member.tgUserId) && !hasBlockInWindow(member.tgUserId, tz, now)) return undefined;
  return { prefilled: true, busy_slots: [...busy].sort(), hours: prefillHours() };
}
