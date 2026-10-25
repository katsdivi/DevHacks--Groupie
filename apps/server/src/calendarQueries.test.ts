import { beforeEach, describe, expect, it } from 'vitest';
import { db, schema } from './db/index.ts';
import {
  courseCode,
  eventsForMembersInCourse,
  loadScores,
  otherCourseCounts,
  projectWindowEnd,
  sameCourse,
  upcomingForUser,
} from './calendarQueries.ts';

const now = new Date('2026-10-26T17:00:00Z'); // Mon 10 AM Phoenix
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
let uid = 0;
const ev = (tg: number, course: string | null, title: string, dueAt: string, removedAt: string | null = null) =>
  db
    .insert(schema.calendarEvents)
    .values({ telegramUserId: tg, uid: `u${++uid}`, course, title, dueAt, kind: 'assignment', removedAt, updatedAt: now.toISOString() })
    .run();

describe('courseCode and sameCourse', () => {
  it('pulls the code out of feed brackets and import names', () => {
    expect(courseCode('CSE 340 (Fall 2026)')).toBe('CSE 340');
    expect(courseCode('CSE 340: Software Engineering')).toBe('CSE 340');
    expect(courseCode('cse340')).toBe('CSE 340');
    expect(courseCode('MAT-265 Calculus')).toBe('MAT 265');
    expect(courseCode('Software Engineering')).toBeNull();
    expect(courseCode(null)).toBeNull();
  });
  it('matches by code, falls back to names, never matches empty', () => {
    expect(sameCourse('CSE 340 (Fall 2026)', 'CSE 340: Software Engineering')).toBe(true);
    expect(sameCourse('CSE 340 (Fall 2026)', 'CSE 360: Intro')).toBe(false);
    expect(sameCourse('HST 101 (Fall 2026)', 'CSE 340: Software Engineering')).toBe(false);
    expect(sameCourse('Honors Seminar', ' honors seminar ')).toBe(true);
    expect(sameCourse(null, 'CSE 340')).toBe(false);
    expect(sameCourse('', '')).toBe(false);
  });
});

describe('calendar queries', () => {
  beforeEach(() => {
    db.delete(schema.calendarEvents).run();
  });

  it('returns live items in the window, soonest first, without removed ones', () => {
    ev(1, 'CSE 340 (Fall 2026)', 'Later', inDays(5));
    ev(1, 'HST 101 (Fall 2026)', 'Sooner', inDays(1).replace('.000Z', 'Z'));
    ev(1, 'CSE 340 (Fall 2026)', 'Gone', inDays(2), now.toISOString());
    ev(1, 'CSE 340 (Fall 2026)', 'Past', inDays(-1));
    ev(1, 'CSE 340 (Fall 2026)', 'Too far', inDays(20));
    ev(2, 'CSE 340 (Fall 2026)', 'Someone else', inDays(1));
    const to = new Date(now.getTime() + 14 * 86_400_000);
    expect(upcomingForUser(1, now, to).map((e) => e.title)).toEqual(['Sooner', 'Later']);
    expect(upcomingForUser(1, now, to, 1).map((e) => e.title)).toEqual(['Sooner']);
    expect(eventsForMembersInCourse([1, 2], 'CSE 340: Software Engineering', now, to).map((e) => e.title)).toEqual([
      'Someone else',
      'Later',
    ]);
    expect(eventsForMembersInCourse([1, 2], null, now, to)).toEqual([]);
    expect(otherCourseCounts([1, 2, 3], 'CSE 340: Software Engineering', now, to)).toEqual({ 1: 1, 2: 0, 3: 0 });
  });

  it('scores load over the project window, counting the next 7 days double', () => {
    ev(1, 'A 100', 'a', inDays(1));
    ev(1, 'A 100', 'b', inDays(2));
    ev(1, 'A 100', 'c', inDays(3));
    ev(1, 'A 100', 'd', inDays(10));
    ev(1, 'A 100', 'e', inDays(30));
    ev(1, 'A 100', 'f', inDays(2), now.toISOString());
    ev(2, 'A 100', 'g', inDays(9));
    const until = new Date(now.getTime() + 14 * 86_400_000);
    expect(loadScores([1, 2, 3], now, until)).toEqual({
      1: { score: 7, dueSoon: 3 },
      2: { score: 1, dueSoon: 0 },
      3: { score: 0, dueSoon: 0 },
    });
    // A window shorter than 7 days still reports the week for the busy tag, but scores only the window.
    expect(loadScores([1], now, new Date(now.getTime() + 2.5 * 86_400_000))[1]).toEqual({ score: 4, dueSoon: 3 });
  });

  it('uses the due date for the window, else 14 days', () => {
    expect(projectWindowEnd(null, now).getTime()).toBe(now.getTime() + 14 * 86_400_000);
    expect(projectWindowEnd('2026-10-01', now).getTime()).toBe(now.getTime() + 14 * 86_400_000);
    expect(projectWindowEnd('2026-11-20', now).getTime()).toBeGreaterThan(Date.parse('2026-11-21T06:59:00Z'));
  });
});
