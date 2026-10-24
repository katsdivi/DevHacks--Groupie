import { describe, expect, it } from 'vitest';
import { buildGrid, formatMeeting, normalizeSlot, slotEnd, slotStart } from './time.ts';

describe('grid and slots', () => {
  const now = new Date('2026-10-24T20:00:00Z'); // 1 PM in Phoenix
  it('builds 7 days of 9am to 10pm rows in the group time zone', () => {
    const g = buildGrid('America/Phoenix', now);
    expect(g.days).toHaveLength(7);
    expect(g.days[0]).toMatchObject({ date: '2026-10-24', weekday: 'Sat', isToday: true });
    expect(g.rows).toHaveLength(26);
    expect(g.rows[0]).toMatchObject({ hour: 9, minute: 0, label: '9 AM' });
    expect(g.rows.at(-1)).toMatchObject({ hour: 21, minute: 30 });
  });
  it('maps cells to UTC slot ids and back', () => {
    expect(slotStart('America/Phoenix', '2026-10-25', 16, 0)).toBe('2026-10-25T23:00:00.000Z');
    expect(slotStart('Asia/Kolkata', '2026-10-25', 9, 30)).toBe('2026-10-25T04:00:00.000Z');
    expect(slotEnd('2026-10-25T23:00:00.000Z', 2)).toBe('2026-10-26T00:00:00.000Z');
  });
  it('handles DST zones', () => {
    // New York switches back on Nov 1, 2026.
    expect(slotStart('America/New_York', '2026-10-31', 10, 0)).toBe('2026-10-31T14:00:00.000Z');
    expect(slotStart('America/New_York', '2026-11-02', 10, 0)).toBe('2026-11-02T15:00:00.000Z');
  });
  it('normalizes and rejects slot ids', () => {
    expect(normalizeSlot('2026-10-25T23:00:00Z')).toBe('2026-10-25T23:00:00.000Z');
    expect(normalizeSlot('2026-10-25T16:00:00-07:00')).toBe('2026-10-25T23:00:00.000Z');
    expect(normalizeSlot('2026-10-25T23:15:00Z')).toBeNull();
    expect(normalizeSlot('nope')).toBeNull();
  });
  it('formats meeting times', () => {
    expect(formatMeeting('2026-10-25T23:00:00.000Z', '2026-10-26T00:00:00.000Z', 'America/Phoenix')).toBe('Sun, Oct 25 · 4 to 5 PM');
    expect(formatMeeting('2026-10-25T18:30:00.000Z', '2026-10-25T19:30:00.000Z', 'America/Phoenix')).toBe('Sun, Oct 25 · 11:30 AM to 12:30 PM');
  });
});
