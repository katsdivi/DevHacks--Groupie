import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { icsDateToIso, parseCanvasFeed, readIcs, splitSummary } from './ics.ts';

const sample = fs.readFileSync(new URL('../../../../fixtures/feed/sample.ics', import.meta.url), 'utf8');

describe('parseCanvasFeed', () => {
  const events = parseCanvasFeed(sample);
  it('reads every event from the fixture', () => {
    expect(events).toHaveLength(9);
  });
  it('splits course from the title and reads URL and UTC due date', () => {
    expect(events[0]).toEqual({
      uid: 'event-assignment-7654321',
      course: 'CSE 340 (Fall 2026)',
      title: 'Project 2: Campus Food Finder',
      dueAt: '2026-11-21T06:59:00.000Z',
      description: 'Group project. Teams of 4 to 6.',
      url: 'https://canvas.asu.edu/courses/123456/assignments/7654321',
      kind: 'assignment',
    });
  });
  it('marks non-assignment UIDs as events', () => {
    const e = events.find((x) => x.uid === 'event-calendar-5500001')!;
    expect(e.kind).toBe('event');
    expect(e.title).toBe('Project 2 team check-in (office hours)');
    expect(new Set(events.map((x) => x.course))).toEqual(new Set(['CSE 340 (Fall 2026)', 'HST 101 (Fall 2026)']));
  });
  it('rejects text that is not a calendar', () => {
    expect(() => parseCanvasFeed('<html>login</html>')).toThrow();
  });
});

describe('ics details', () => {
  it('unfolds lines and unescapes text', () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:event-assignment-1\r\nDTSTART:20261121T065900Z\r\nSUMMARY:Long\r\n  title\\, part 2 [ABC 1]\r\nDESCRIPTION:a\\nb\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    expect(parseCanvasFeed(ics)[0]).toMatchObject({ title: 'Long title, part 2', course: 'ABC 1', description: 'a\nb' });
  });
  it('converts TZID, floating, and all-day dates to UTC', () => {
    expect(icsDateToIso({ value: '20261120T235900', params: { TZID: 'America/Phoenix' } }, null)).toBe('2026-11-21T06:59:00.000Z');
    expect(icsDateToIso({ value: '20261120T235900', params: {} }, 'America/Phoenix')).toBe('2026-11-21T06:59:00.000Z');
    expect(icsDateToIso({ value: '20261120', params: { VALUE: 'DATE' } }, 'America/Phoenix')).toBe('2026-11-20T07:00:00.000Z');
    expect(icsDateToIso({ value: 'soon', params: {} }, null)).toBeNull();
  });
  it('leaves summaries without a course alone', () => {
    expect(splitSummary('Office hours')).toEqual({ title: 'Office hours', course: null });
    expect(readIcs(sample).tz).toBe('America/Phoenix');
  });
});
