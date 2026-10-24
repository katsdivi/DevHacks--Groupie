import { DateTime } from 'luxon';

export const SLOT_MINUTES = 30;
export const GRID_DAYS = 7;
export const GRID_START_HOUR = 9;
export const GRID_END_HOUR = 22;
/** Meetings are an hour: two back-to-back slots. */
export const MEETING_SLOTS = 2;

export type GridDay = { date: string; weekday: string; dayNum: string; isToday: boolean };
export type GridRow = { hour: number; minute: number; label: string };
export type Grid = { tz: string; days: GridDay[]; rows: GridRow[] };

/** The 7 days by 30-minute rows shown in the availability grid, in the group's time zone. */
export function buildGrid(tz: string, now: Date = new Date()): Grid {
  const today = DateTime.fromJSDate(now, { zone: tz }).startOf('day');
  const days = Array.from({ length: GRID_DAYS }, (_, i) => {
    const d = today.plus({ days: i });
    return { date: d.toISODate()!, weekday: d.toFormat('ccc'), dayNum: d.toFormat('d'), isToday: i === 0 };
  });
  const rows: GridRow[] = [];
  for (let h = GRID_START_HOUR; h < GRID_END_HOUR; h++) {
    for (const m of [0, 30]) {
      rows.push({ hour: h, minute: m, label: m === 0 ? DateTime.fromObject({ hour: h }).toFormat('h a') : '' });
    }
  }
  return { tz, days, rows };
}

/** UTC ISO start of a grid cell (canonical slot id, e.g. "2026-10-25T23:00:00.000Z"). */
export function slotStart(tz: string, date: string, hour: number, minute: number): string {
  return DateTime.fromISO(date, { zone: tz }).set({ hour, minute, second: 0, millisecond: 0 }).toUTC().toISO()!;
}

export function slotEnd(start: string, slots = 1): string {
  return DateTime.fromISO(start, { zone: 'utc' }).plus({ minutes: SLOT_MINUTES * slots }).toUTC().toISO()!;
}

/** Normalizes any ISO string to the canonical slot id, or null if it isn't on a 30-minute boundary. */
export function normalizeSlot(iso: string): string | null {
  const d = DateTime.fromISO(iso, { zone: 'utc' });
  if (!d.isValid || d.second !== 0 || d.millisecond !== 0 || d.minute % SLOT_MINUTES !== 0) return null;
  return d.toUTC().toISO()!;
}

/** "Sun, Oct 25 · 4 to 5 PM" in the group's time zone. */
export function formatMeeting(start: string, end: string, tz: string): string {
  const s = DateTime.fromISO(start, { zone: 'utc' }).setZone(tz);
  const e = DateTime.fromISO(end, { zone: 'utc' }).setZone(tz);
  const t = (d: DateTime) => (d.minute === 0 ? d.toFormat('h') : d.toFormat('h:mm'));
  const sameMeridiem = s.toFormat('a') === e.toFormat('a');
  const range = sameMeridiem ? `${t(s)} to ${t(e)} ${e.toFormat('a')}` : `${t(s)} ${s.toFormat('a')} to ${t(e)} ${e.toFormat('a')}`;
  return `${s.toFormat('ccc, LLL d')} · ${range}`;
}

/** Short zone label like "MST" for display. */
export function tzLabel(tz: string, at: Date = new Date()): string {
  return DateTime.fromJSDate(at, { zone: tz }).toFormat('ZZZZ');
}
