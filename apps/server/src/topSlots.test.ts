import { describe, expect, it } from 'vitest';
import { topSlots } from './availability.ts';

const tz = 'America/Phoenix';
const now = new Date('2026-10-24T20:00:00Z'); // Sat 1 PM Phoenix

/** Slot map from [utc start, member ids] for consecutive 30-minute slots starting at `from`. */
function run(from: string, count: number, ids: number[], into: Record<string, number[]> = {}) {
  const t0 = Date.parse(from);
  for (let i = 0; i < count; i++) {
    const key = new Date(t0 + i * 1_800_000).toISOString();
    into[key] = [...new Set([...(into[key] ?? []), ...ids])].sort((a, b) => a - b);
  }
  return into;
}

describe('topSlots', () => {
  it('ranks by attendance first', () => {
    const map = run('2026-10-25T17:00:00.000Z', 2, [1, 2]); // Sun 10 AM, 2 free
    run('2026-10-26T23:00:00.000Z', 2, [1, 2, 3], map); // Mon 4 PM, 3 free
    const top = topSlots(map, tz, 3, now);
    expect(top.map((t) => t.start)).toEqual(['2026-10-26T23:00:00.000Z', '2026-10-25T17:00:00.000Z']);
    expect(top[0]!.member_ids).toEqual([1, 2, 3]);
  });

  it('then prefers the longer shared free run (duration fit)', () => {
    const map = run('2026-10-25T17:00:00.000Z', 2, [1, 2]); // exactly one hour
    run('2026-10-26T17:00:00.000Z', 6, [1, 2], map); // three hours free
    const top = topSlots(map, tz, 2, now, 1);
    expect(top[0]!.start).toBe('2026-10-26T17:00:00.000Z');
    expect(top[0]!.fit).toBe(4);
  });

  it('then picks the earliest on a full tie', () => {
    const map = run('2026-10-26T17:00:00.000Z', 2, [1, 2]);
    run('2026-10-25T17:00:00.000Z', 2, [1, 2], map);
    expect(topSlots(map, tz, 2, now).map((t) => t.start)).toEqual(['2026-10-25T17:00:00.000Z', '2026-10-26T17:00:00.000Z']);
  });

  it('returns distinct, non-overlapping hours', () => {
    const map = run('2026-10-25T23:00:00.000Z', 3, [1, 2, 3]); // 4:00 to 5:30, so 4:00 and 4:30 overlap
    run('2026-10-27T01:00:00.000Z', 2, [1, 2], map);
    const top = topSlots(map, tz, 3, now);
    expect(top).toHaveLength(2);
    expect(top[0]!.start).toBe('2026-10-25T23:00:00.000Z');
    expect(top[1]!.start).toBe('2026-10-27T01:00:00.000Z');
    for (const a of top) for (const b of top) if (a !== b) expect(a.start < b.end && a.end > b.start).toBe(false);
  });

  it('caps at 3 and never returns past or lonely hours', () => {
    const map: Record<string, number[]> = {};
    for (const day of ['25', '26', '27', '28', '29']) run(`2026-10-${day}T23:00:00.000Z`, 2, [1, 2], map);
    run('2026-10-24T17:00:00.000Z', 2, [1, 2, 3], map); // this morning, already past
    run('2026-10-30T17:00:00.000Z', 2, [3], map); // only one person
    const top = topSlots(map, tz, 3, now);
    expect(top).toHaveLength(3);
    expect(top.every((t) => t.start > now.toISOString() && t.member_ids.length >= 2)).toBe(true);
  });

  it('labels in America/Phoenix with counts, with no DST shift in November', () => {
    const map = run('2026-10-25T23:00:00.000Z', 2, [1, 2, 3, 4, 5]);
    run('2026-11-02T23:00:00.000Z', 2, [1, 2], map); // after US DST ends; Phoenix stays UTC-7
    const top = topSlots(map, tz, 5, now);
    expect(top.map((t) => t.label)).toEqual(['Sun, Oct 25 · 4 to 5 PM (5/5 free)', 'Mon, Nov 2 · 4 to 5 PM (2/5 free)']);
  });

  it('works when nobody has a calendar (manual grid only) and with a single viable hour', () => {
    const map = run('2026-10-25T23:00:00.000Z', 2, [1, 2]);
    run('2026-10-26T23:00:00.000Z', 1, [1, 2], map); // half an hour is not a meeting
    expect(topSlots(map, tz, 4, now)).toHaveLength(1);
    expect(topSlots({}, tz, 4, now)).toEqual([]);
  });
});
