import { describe, expect, it } from 'vitest';
import { daysLeft } from './progress.ts';

describe('daysLeft', () => {
  const now = new Date('2026-10-24T20:00:00Z'); // Sat 1 PM Phoenix
  it('counts whole days in the group time zone', () => {
    expect(daysLeft('2026-11-20', 'America/Phoenix', now)).toBe(27);
    expect(daysLeft('2026-10-24', 'America/Phoenix', now)).toBe(0);
    expect(daysLeft('2026-10-22', 'America/Phoenix', now)).toBe(-2);
    expect(daysLeft(null, 'America/Phoenix', now)).toBeNull();
  });
});
