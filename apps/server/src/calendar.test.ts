import { describe, expect, it } from 'vitest';
import { buildEventRequest } from './calendar.ts';

const base = {
  summary: 'Campus Food Finder: team meeting',
  description: 'Planned by Motu',
  start: '2026-10-25T23:00:00.000Z',
  end: '2026-10-26T00:00:00.000Z',
  tz: 'America/Phoenix',
  attendees: ['a@x.com', 'b@x.com'],
  location: null,
  requestId: 'groupie-1-1',
};

describe('buildEventRequest', () => {
  it('asks Google for a Meet link and emails everyone', () => {
    const r = buildEventRequest({ ...base, withMeet: true });
    expect(r.conferenceDataVersion).toBe(1);
    expect(r.sendUpdates).toBe('all');
    expect(r.requestBody.attendees).toEqual([{ email: 'a@x.com' }, { email: 'b@x.com' }]);
    expect(r.requestBody.conferenceData).toEqual({
      createRequest: { requestId: 'groupie-1-1', conferenceSolutionKey: { type: 'hangoutsMeet' } },
    });
    expect(r.requestBody.start).toEqual({ dateTime: base.start, timeZone: 'America/Phoenix' });
  });
  it('uses the given link or place without a Meet request', () => {
    const r = buildEventRequest({ ...base, withMeet: false, location: 'https://zoom.us/j/1' });
    expect(r.conferenceDataVersion).toBe(0);
    expect(r.requestBody).not.toHaveProperty('conferenceData');
    expect(r.requestBody.location).toBe('https://zoom.us/j/1');
  });
});
