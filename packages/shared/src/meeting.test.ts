import { describe, expect, it } from 'vitest';
import { extractUrl, googleCalendarUrl, icsFile, parseMeetingLocation } from './meeting.ts';

const m = {
  title: 'Campus Food Finder: team meeting',
  start: '2026-10-25T23:00:00.000Z',
  end: '2026-10-26T00:00:00.000Z',
  details: 'Planned by Groupie.\nAgenda: check in, unblock, next steps',
  location: 'https://zoom.us/j/123456789?pwd=abc',
};

describe('meeting links', () => {
  it('builds a Google Calendar template link', () => {
    const u = new URL(googleCalendarUrl(m));
    expect(u.hostname).toBe('calendar.google.com');
    expect(u.searchParams.get('dates')).toBe('20261025T230000Z/20261026T000000Z');
    expect(u.searchParams.get('location')).toBe(m.location);
  });
  it('builds a valid ics file', () => {
    const ics = icsFile({ ...m, uid: 'g1-m1@groupie' }, new Date('2026-10-24T00:00:00Z'));
    expect(ics).toContain('DTSTART:20261025T230000Z');
    expect(ics).toContain('SUMMARY:Campus Food Finder: team meeting');
    expect(ics).toContain('DESCRIPTION:Planned by Groupie.\\nAgenda: check in\\, unblock\\, next steps');
    expect(ics).toContain('URL:https://zoom.us/j/123456789?pwd=abc');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
    expect(icsFile({ ...m, title: 'A; B', uid: 'u' })).toContain('SUMMARY:A\\; B');
  });
  it('extracts and validates links and places', () => {
    expect(extractUrl('here: https://meet.google.com/abc-defg-hij.')).toBe('https://meet.google.com/abc-defg-hij');
    expect(parseMeetingLocation('join https://zoom.us/j/1 thanks', 'zoom')).toBe('https://zoom.us/j/1');
    expect(parseMeetingLocation('no link here', 'zoom')).toBeNull();
    expect(parseMeetingLocation('  Hayden Library,  room 2B ', 'in_person')).toBe('Hayden Library, room 2B');
    expect(parseMeetingLocation('', 'in_person')).toBeNull();
  });
});
