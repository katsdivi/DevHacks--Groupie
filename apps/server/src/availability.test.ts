import { describe, expect, it } from 'vitest';
import { bestWindows, cleanSlots } from './availability.ts';

const tz = 'America/Phoenix';
const now = new Date('2026-10-24T20:00:00Z'); // Sat 1 PM Phoenix

describe('bestWindows', () => {
  it('ranks hour windows by people free for the whole hour, then earliest', () => {
    const slots = {
      '2026-10-25T23:00:00.000Z': [1, 2, 3], // Sun 4:00
      '2026-10-25T23:30:00.000Z': [1, 2, 3], // Sun 4:30
      '2026-10-26T00:00:00.000Z': [1, 2], // Sun 5:00
      '2026-10-25T17:00:00.000Z': [1, 2, 3, 4], // Sun 10:00, but 10:30 missing
    };
    const best = bestWindows(slots, tz, now);
    expect(best[0]).toMatchObject({ start: '2026-10-25T23:00:00.000Z', end: '2026-10-26T00:00:00.000Z', member_ids: [1, 2, 3] });
    expect(best[0]!.label).toBe('Sun, Oct 25 · 4 to 5 PM');
    expect(best[1]).toMatchObject({ start: '2026-10-25T23:30:00.000Z', member_ids: [1, 2] });
    expect(best.some((b) => b.start === '2026-10-25T17:00:00.000Z')).toBe(false);
  });
  it('ignores past windows', () => {
    expect(bestWindows({ '2026-10-24T18:00:00.000Z': [1], '2026-10-24T18:30:00.000Z': [1] }, tz, now)).toEqual([]);
  });
});

describe('cleanSlots', () => {
  it('drops misaligned, out of range, and duplicate slots', () => {
    const out = cleanSlots(
      ['2026-10-25T23:00:00Z', '2026-10-25T23:00:00.000Z', '2026-10-25T23:10:00Z', '2026-11-20T23:00:00Z', 'x', '2026-10-24T08:00:00Z'],
      tz,
      now,
    );
    expect(out).toEqual(['2026-10-24T08:00:00.000Z', '2026-10-25T23:00:00.000Z']);
  });
});
