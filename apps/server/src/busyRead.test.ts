import { describe, expect, it } from 'vitest';
import { db, schema } from './db/index.ts';
import { busySlotsFor, gridSlots, overlapSlots, prefillFor, prefillHours } from './busyRead.ts';

const tz = 'America/Phoenix';
const now = new Date('2026-10-24T20:00:00Z'); // Sat 1 PM Phoenix

const block = (telegramUserId: number, startAt: string, endAt: string, source: 'google' | 'ics' | 'canvas' = 'google') =>
  db.insert(schema.busyBlocks).values({ telegramUserId, startAt, endAt, source }).run();

describe('overlapSlots', () => {
  const slots = ['2026-10-25T23:00:00.000Z', '2026-10-25T23:30:00.000Z', '2026-10-26T00:00:00.000Z', '2026-10-26T00:30:00.000Z'];

  it('marks every slot a block touches, including partial overlaps', () => {
    const out = overlapSlots([{ startAt: '2026-10-25T23:10:00Z', endAt: '2026-10-25T23:40:00Z' }], slots);
    expect([...out].sort()).toEqual(['2026-10-25T23:00:00.000Z', '2026-10-25T23:30:00.000Z']);
  });

  it('does not count blocks that only touch a slot edge', () => {
    const out = overlapSlots([{ startAt: '2026-10-25T22:00:00Z', endAt: '2026-10-25T23:00:00Z' }, { startAt: '2026-10-26T01:00:00Z', endAt: '2026-10-26T02:00:00Z' }], slots);
    expect(out.size).toBe(0);
  });

  it('handles blocks crossing UTC midnight', () => {
    const out = overlapSlots([{ startAt: '2026-10-25T23:45:00Z', endAt: '2026-10-26T00:15:00Z' }], slots);
    expect([...out].sort()).toEqual(['2026-10-25T23:30:00.000Z', '2026-10-26T00:00:00.000Z']);
  });

  it('handles blocks crossing local midnight and ignores broken ones', () => {
    const late = ['2026-10-26T06:30:00.000Z', '2026-10-26T07:00:00.000Z', '2026-10-26T07:30:00.000Z']; // 11:30 PM to 12:30 AM Phoenix
    const out = overlapSlots(
      [
        { startAt: '2026-10-25T23:00:00-07:00', endAt: '2026-10-26T00:30:00-07:00' },
        { startAt: 'nope', endAt: '2026-10-26T07:00:00Z' },
        { startAt: '2026-10-26T07:30:00Z', endAt: '2026-10-26T07:30:00Z' },
      ],
      late,
    );
    expect([...out].sort()).toEqual(['2026-10-26T06:30:00.000Z', '2026-10-26T07:00:00.000Z']);
  });
});

describe('busySlotsFor', () => {
  it('reads only this user and only overlapping blocks', () => {
    block(501, '2026-10-25T23:00:00.000Z', '2026-10-26T00:00:00.000Z');
    block(502, '2026-10-26T00:00:00.000Z', '2026-10-26T01:00:00.000Z');
    block(501, '2026-11-20T23:00:00.000Z', '2026-11-21T00:00:00.000Z');
    const slots = gridSlots(tz, now);
    const out = busySlotsFor(501, slots);
    expect([...out].sort()).toEqual(['2026-10-25T23:00:00.000Z', '2026-10-25T23:30:00.000Z']);
    expect(busySlotsFor(502, [])).toEqual(new Set());
  });
});

describe('prefillFor', () => {
  it('prefills members with busy blocks on the grid', () => {
    block(601, '2026-10-26T17:00:00.000Z', '2026-10-26T18:30:00.000Z', 'ics'); // Mon 10 to 11:30 AM
    const p = prefillFor({ tgUserId: 601 }, tz, now);
    expect(p).toEqual({
      prefilled: true,
      busy_slots: ['2026-10-26T17:00:00.000Z', '2026-10-26T17:30:00.000Z', '2026-10-26T18:00:00.000Z'],
      hours: { start: 8, end: 22 },
    });
  });

  it('prefills a connected calendar with no blocks (everything free)', () => {
    db.insert(schema.calendarConnections).values({ telegramUserId: 602, kind: 'google', createdAt: now.toISOString() }).run();
    expect(prefillFor({ tgUserId: 602 }, tz, now)).toMatchObject({ prefilled: true, busy_slots: [] });
  });

  it('counts a block on the grid days even outside the grid hours', () => {
    block(603, '2026-10-26T13:00:00.000Z', '2026-10-26T14:00:00.000Z'); // Mon 6 AM Phoenix
    expect(prefillFor({ tgUserId: 603 }, tz, now)).toMatchObject({ prefilled: true, busy_slots: [] });
  });

  it('skips members without calendar data, without a Telegram id, and seeds', () => {
    block(604, '2026-12-01T17:00:00.000Z', '2026-12-01T18:00:00.000Z'); // outside the window
    expect(prefillFor({ tgUserId: 604 }, tz, now)).toBeUndefined();
    expect(prefillFor({ tgUserId: 999 }, tz, now)).toBeUndefined();
    expect(prefillFor({ tgUserId: null }, tz, now)).toBeUndefined();
    block(605, '2026-10-26T17:00:00.000Z', '2026-10-26T18:00:00.000Z');
    expect(prefillFor({ tgUserId: 605, isSeed: true }, tz, now)).toBeUndefined();
  });
});

describe('prefillHours', () => {
  it('defaults to 8 to 22 and reads valid env overrides', () => {
    expect(prefillHours({})).toEqual({ start: 8, end: 22 });
    expect(prefillHours({ PREFILL_START_HOUR: '9', PREFILL_END_HOUR: '20' })).toEqual({ start: 9, end: 20 });
    expect(prefillHours({ PREFILL_START_HOUR: 'x', PREFILL_END_HOUR: '30' })).toEqual({ start: 8, end: 22 });
    expect(prefillHours({ PREFILL_START_HOUR: '21', PREFILL_END_HOUR: '9' })).toEqual({ start: 8, end: 22 });
  });
});
