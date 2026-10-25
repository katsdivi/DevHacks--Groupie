import { describe, expect, it } from 'vitest';
import { buildMime } from './gmail.ts';

describe('buildMime', () => {
  it('builds text, html, and an attachment with encoded headers', () => {
    const mime = buildMime({
      to: ['a@x.com', 'b@x.com'],
      subject: 'Team meeting 📅',
      text: 'Join: https://meet.google.com/abc',
      html: '<p>Join</p>',
      attachments: [{ filename: 'team-meeting.ics', contentType: 'text/calendar', content: 'BEGIN:VCALENDAR' }],
    });
    expect(mime).toContain('To: a@x.com, b@x.com');
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?.+\?=/);
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(mime).toContain('filename="team-meeting.ics"');
    expect(mime).toContain(Buffer.from('BEGIN:VCALENDAR').toString('base64'));
  });
});
