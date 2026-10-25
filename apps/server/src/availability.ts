import { and, desc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import {
  buildGrid,
  formatMeeting,
  MEETING_SLOTS,
  normalizeSlot,
  SLOT_MINUTES,
  slotEnd,
  slotStart,
  type HeatmapBest,
  type HeatmapResponse,
} from '@groupie/shared';
import { db, schema } from './db/index.ts';
import { getGroup } from './groups.ts';
import { listMembers } from './members.ts';

const { availability, meetings, groups } = schema;

export function getSlots(memberId: number): string[] {
  return db
    .select()
    .from(availability)
    .where(eq(availability.memberId, memberId))
    .orderBy(availability.slotStart)
    .all()
    .map((r) => r.slotStart);
}

/** Keeps only valid 30-minute slots from the start of today (group tz) to 8 days out. */
export function cleanSlots(raw: string[], tz: string, now = new Date()): string[] {
  const from = DateTime.fromJSDate(now, { zone: tz }).startOf('day').toUTC();
  const to = from.plus({ days: 8 });
  const out = new Set<string>();
  for (const r of raw) {
    const s = normalizeSlot(r);
    if (!s) continue;
    const d = DateTime.fromISO(s, { zone: 'utc' });
    if (d >= from && d < to) out.add(s);
  }
  return [...out].sort();
}

/** Replaces a member's availability with exactly these slots. */
export function setSlots(memberId: number, slots: string[]) {
  db.transaction((tx) => {
    tx.delete(availability).where(eq(availability.memberId, memberId)).run();
    for (const s of slots) tx.insert(availability).values({ memberId, slotStart: s, slotEnd: slotEnd(s) }).run();
  });
}

export function respondedCount(groupId: number): number {
  const members = listMembers(groupId);
  if (!members.length) return 0;
  const rows = db
    .selectDistinct({ memberId: availability.memberId })
    .from(availability)
    .where(inArray(availability.memberId, members.map((m) => m.id)))
    .all();
  return rows.length;
}

/**
 * Best one-hour windows: two back-to-back slots, ranked by how many people are free for both,
 * then earliest. Only future windows count.
 */
export function bestWindows(slotMap: Record<string, number[]>, tz: string, now = new Date(), limit = 5): HeatmapBest[] {
  const nowIso = now.toISOString();
  const out: HeatmapBest[] = [];
  for (const start of Object.keys(slotMap).sort()) {
    if (start < nowIso) continue;
    let free = new Set(slotMap[start]);
    let cursor = start;
    for (let k = 1; k < MEETING_SLOTS && free.size; k++) {
      cursor = slotEnd(cursor);
      const next = new Set(slotMap[cursor] ?? []);
      free = new Set([...free].filter((id) => next.has(id)));
    }
    if (!free.size) continue;
    const end = slotEnd(start, MEETING_SLOTS);
    out.push({ start, end, member_ids: [...free].sort((a, b) => a - b), label: formatMeeting(start, end, tz) });
  }
  out.sort((a, b) => b.member_ids.length - a.member_ids.length || a.start.localeCompare(b.start));
  return out.slice(0, limit);
}

export type TimeCandidate = {
  start: string;
  end: string;
  /** Members free for the whole hour. */
  member_ids: number[];
  /** Extra 30-minute slots around the hour when every one of them is still free. */
  fit: number;
  /** "Sun, Oct 25 · 4 to 5 PM (5/5 free)". */
  label: string;
};

/** Members free for every slot of the hour starting here. */
export function freeForHour(slotMap: Record<string, number[]>, start: string): number[] {
  let free = new Set(slotMap[start] ?? []);
  let cursor = start;
  for (let k = 1; k < MEETING_SLOTS && free.size; k++) {
    cursor = slotEnd(cursor);
    const next = new Set(slotMap[cursor] ?? []);
    free = new Set([...free].filter((id) => next.has(id)));
  }
  return [...free].sort((a, b) => a - b);
}

/** Back-to-back slots before and after [start, end) when all of these members stay free. */
function runAround(slotMap: Record<string, number[]>, start: string, end: string, ids: number[]): number {
  const allFree = (slot: string) => {
    const at = new Set(slotMap[slot] ?? []);
    return ids.every((id) => at.has(id));
  };
  const step = SLOT_MINUTES * 60_000;
  let n = 0;
  for (let t = Date.parse(start) - step; allFree(new Date(t).toISOString()); t -= step) n++;
  for (let t = Date.parse(end); allFree(new Date(t).toISOString()); t += step) n++;
  return n;
}

/**
 * Top one-hour slots for the time poll: most people free, then the longest shared free run around
 * the hour (duration fit), then earliest. Picks never overlap. Viable means at least two people
 * free (one for a team of one). Only future hours count.
 */
export function topSlots(
  slotMap: Record<string, number[]>,
  tz: string,
  teamSize: number,
  now = new Date(),
  limit = 3,
): TimeCandidate[] {
  const nowIso = now.toISOString();
  const minFree = Math.min(2, Math.max(1, teamSize));
  const all: TimeCandidate[] = [];
  for (const start of Object.keys(slotMap).sort()) {
    if (start < nowIso) continue;
    const ids = freeForHour(slotMap, start);
    if (ids.length < minFree) continue;
    const end = slotEnd(start, MEETING_SLOTS);
    all.push({ start, end, member_ids: ids, fit: runAround(slotMap, start, end, ids), label: '' });
  }
  all.sort((a, b) => b.member_ids.length - a.member_ids.length || b.fit - a.fit || a.start.localeCompare(b.start));
  const picked: TimeCandidate[] = [];
  for (const c of all) {
    if (picked.length >= limit) break;
    if (picked.some((p) => c.start < p.end && c.end > p.start)) continue;
    picked.push({ ...c, label: `${formatMeeting(c.start, c.end, tz)} (${c.member_ids.length}/${teamSize} free)` });
  }
  return picked;
}

export function heatmap(groupId: number, now = new Date()): HeatmapResponse {
  const group = getGroup(groupId)!;
  const members = listMembers(groupId);
  const rows = members.length
    ? db.select().from(availability).where(inArray(availability.memberId, members.map((m) => m.id))).all()
    : [];
  const slotMap: Record<string, number[]> = {};
  const responded = new Set<number>();
  for (const r of rows) {
    (slotMap[r.slotStart] ??= []).push(r.memberId);
    responded.add(r.memberId);
  }
  return {
    tz: group.tz,
    team_size: group.teamSize ?? members.length,
    responded: responded.size,
    members: members.map((m) => ({ id: m.id, name: m.name, color: m.color, responded: responded.has(m.id) })),
    slots: slotMap,
    best: bestWindows(slotMap, group.tz, now),
  };
}

/** Pretend availability for seed members: everyone overlaps on a couple of afternoons, plus some noise. */
export function seedAvailability(groupId: number, now = new Date()) {
  const group = getGroup(groupId)!;
  const grid = buildGrid(group.tz, now);
  const seeds = listMembers(groupId).filter((m) => m.isSeed && getSlots(m.id).length === 0);
  seeds.forEach((m, idx) => {
    const picked = new Set<string>();
    grid.days.forEach((day, d) => {
      for (const row of grid.rows) {
        const hourKey = row.hour + row.minute / 60;
        // Shared windows: 4 to 6 PM on days 1 and 3, 7 to 8:30 PM on day 2.
        const shared = ((d === 1 || d === 3) && hourKey >= 16 && hourKey < 18) || (d === 2 && hourKey >= 19 && hourKey < 20.5);
        // Deterministic noise per member so the heatmap has texture.
        const noise = (m.id * 31 + d * 17 + row.hour * 7 + row.minute + idx * 13) % 9 < 3 && hourKey >= 12;
        if (shared || noise) picked.add(slotStart(group.tz, day.date, row.hour, row.minute));
      }
    });
    setSlots(m.id, cleanSlots([...picked], group.tz, now));
  });
  return seeds.length;
}

export function latestMeeting(groupId: number) {
  return db.select().from(meetings).where(eq(meetings.groupId, groupId)).orderBy(desc(meetings.id)).get();
}

export function createMeeting(groupId: number, start: string, end: string) {
  return db.insert(meetings).values({ groupId, start, end, createdAt: new Date().toISOString() }).returning().get();
}

export function updateMeeting(id: number, values: Partial<typeof meetings.$inferInsert>) {
  db.update(meetings).set(values).where(eq(meetings.id, id)).run();
}

export function meetingByPoll(pollId: string) {
  return db.select().from(meetings).where(eq(meetings.pollId, pollId)).get();
}

export function setAvailMessage(groupId: number, availMessageId: number | null) {
  db.update(groups).set({ availMessageId }).where(and(eq(groups.id, groupId))).run();
}

/** Lock the meeting at this time even if not everyone has answered (null clears it). */
export function setAvailDeadline(groupId: number, at: string | null) {
  db.update(groups).set({ availDeadlineAt: at }).where(eq(groups.id, groupId)).run();
}

/** Groups still scheduling whose deadline has passed. */
export function dueAvailDeadlines(now = new Date()) {
  return db
    .select()
    .from(groups)
    .where(and(eq(groups.status, 'scheduling'), isNotNull(groups.availDeadlineAt), lte(groups.availDeadlineAt, now.toISOString())))
    .all();
}

export function setGroupStatus(groupId: number, status: 'scheduling' | 'active') {
  db.update(groups).set({ status }).where(eq(groups.id, groupId)).run();
}

