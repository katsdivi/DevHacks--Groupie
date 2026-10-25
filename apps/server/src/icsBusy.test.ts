import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchIcsText, icsToBusy, IcsUrlError, isPrivateAddress, normalizeIcsUrl, setIcsFetch, setIcsResolver } from './icsBusy.ts';

/** The window starts Monday 2026-10-26 00:00Z. */
const NOW = new Date('2026-10-26T00:00:00Z');
const ICS_FIXTURE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'X-WR-TIMEZONE:America/Phoenix',
  // 1. Floating time in the calendar zone (Phoenix, UTC-7).
  'BEGIN:VEVENT', 'UID:e1', 'SUMMARY:Secret Therapy Appointment', 'DTSTART:20261027T100000', 'DTEND:20261027T110000', 'END:VEVENT',
  // 2. TZID event in New York (still EDT on Oct 28).
  'BEGIN:VEVENT', 'UID:e2', 'SUMMARY:Job interview', 'DTSTART;TZID=America/New_York:20261028T090000', 'DTEND;TZID=America/New_York:20261028T100000', 'END:VEVENT',
  // 3. Transparent (free) event.
  'BEGIN:VEVENT', 'UID:e3', 'SUMMARY:Free', 'TRANSP:TRANSPARENT', 'DTSTART:20261029T120000Z', 'DTEND:20261029T130000Z', 'END:VEVENT',
  // 4. All-day event.
  'BEGIN:VEVENT', 'UID:e4', 'SUMMARY:Birthday', 'DTSTART;VALUE=DATE:20261030', 'DTEND;VALUE=DATE:20261031', 'END:VEVENT',
  // 5. Weekly MO,WE in Phoenix with one EXDATE.
  'BEGIN:VEVENT', 'UID:e5', 'SUMMARY:Class', 'DTSTART;TZID=America/Phoenix:20261005T140000', 'DTEND;TZID=America/Phoenix:20261005T150000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'EXDATE;TZID=America/Phoenix:20261028T140000', 'END:VEVENT',
  // 6. Weekly in New York across the DST change, two instances.
  'BEGIN:VEVENT', 'UID:e6', 'SUMMARY:Standup', 'DTSTART;TZID=America/New_York:20261027T090000', 'DURATION:PT1H', 'RRULE:FREQ=WEEKLY;COUNT=2', 'END:VEVENT',
  // 7. Monthly: unsupported, first instance only.
  'BEGIN:VEVENT', 'UID:e7', 'SUMMARY:Monthly', 'DTSTART:20261101T180000Z', 'DTEND:20261101T183000Z', 'RRULE:FREQ=MONTHLY', 'END:VEVENT',
  // 8. Cancelled.
  'BEGIN:VEVENT', 'UID:e8', 'SUMMARY:Cancelled', 'STATUS:CANCELLED', 'DTSTART:20261029T150000Z', 'DTEND:20261029T160000Z', 'END:VEVENT',
  // 9. No end: one hour.
  'BEGIN:VEVENT', 'UID:e9', 'SUMMARY:Open ended', 'DTSTART:20261031T200000Z', 'END:VEVENT',
  // 10. Outside the window.
  'BEGIN:VEVENT', 'UID:e10', 'SUMMARY:Later', 'DTSTART:20261201T200000Z', 'DTEND:20261201T210000Z', 'END:VEVENT',
  // 11. Outlook Windows zone name.
  'BEGIN:VEVENT', 'UID:e11', 'SUMMARY:Outlook', 'DTSTART;TZID=US Mountain Standard Time:20261105T080000', 'DTEND;TZID=US Mountain Standard Time:20261105T083000', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const EXPECTED_BLOCKS = [
  { start: '2026-10-26T21:00:00.000Z', end: '2026-10-26T22:00:00.000Z' }, // e5 Monday
  { start: '2026-10-27T13:00:00.000Z', end: '2026-10-27T14:00:00.000Z' }, // e6 EDT
  { start: '2026-10-27T17:00:00.000Z', end: '2026-10-27T18:00:00.000Z' }, // e1 Phoenix floating
  { start: '2026-10-28T13:00:00.000Z', end: '2026-10-28T14:00:00.000Z' }, // e2 TZID New York
  { start: '2026-10-31T20:00:00.000Z', end: '2026-10-31T21:00:00.000Z' }, // e9 no end
  { start: '2026-11-01T18:00:00.000Z', end: '2026-11-01T18:30:00.000Z' }, // e7 monthly first instance
  { start: '2026-11-02T21:00:00.000Z', end: '2026-11-02T22:00:00.000Z' }, // e5 Monday
  { start: '2026-11-03T14:00:00.000Z', end: '2026-11-03T15:00:00.000Z' }, // e6 EST, same wall time
  { start: '2026-11-04T21:00:00.000Z', end: '2026-11-04T22:00:00.000Z' }, // e5 Wednesday
  { start: '2026-11-05T15:00:00.000Z', end: '2026-11-05T15:30:00.000Z' }, // e11 Windows zone
];

describe('icsToBusy', () => {
  it('turns events into start/end blocks, skipping transparent, all-day, cancelled, and out of window', () => {
    const { blocks, unsupportedRules } = icsToBusy(ICS_FIXTURE, NOW, 14);
    const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start));
    expect(sorted).toEqual(EXPECTED_BLOCKS);
    expect(unsupportedRules).toBe(1);
    expect(JSON.stringify(blocks)).not.toMatch(/Therapy|interview|SUMMARY/);
  });

  it('jumps ahead for old open-ended rules instead of walking years', () => {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:d', 'DTSTART:20000101T120000Z', 'DTEND:20000101T130000Z', 'RRULE:FREQ=DAILY', 'END:VEVENT', 'END:VCALENDAR'].join('\n');
    const { blocks } = icsToBusy(ics, NOW, 14);
    expect(blocks).toHaveLength(14);
    expect(blocks[0].start).toBe('2026-10-26T12:00:00.000Z');
  });

  it('honors UNTIL and RECURRENCE-ID overrides', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT', 'UID:r', 'DTSTART:20261026T160000Z', 'DTEND:20261026T170000Z', 'RRULE:FREQ=DAILY;UNTIL=20261028T235959Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:r', 'RECURRENCE-ID:20261027T160000Z', 'DTSTART:20261027T190000Z', 'DTEND:20261027T200000Z', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const starts = icsToBusy(ics, NOW, 14).blocks.map((b) => b.start).sort();
    expect(starts).toEqual(['2026-10-26T16:00:00.000Z', '2026-10-27T19:00:00.000Z', '2026-10-28T16:00:00.000Z']);
  });

  it('throws on something that is not a calendar', () => {
    expect(() => icsToBusy('<html>nope</html>', NOW, 14)).toThrow();
  });
});

describe('normalizeIcsUrl', () => {
  it('accepts https and rewrites webcal', () => {
    expect(normalizeIcsUrl('webcal://p52-caldav.icloud.com/published/2/abc')).toBe('https://p52-caldav.icloud.com/published/2/abc');
    expect(normalizeIcsUrl(' https://outlook.office365.com/owa/calendar/x/y/calendar.ics ')).toBe(
      'https://outlook.office365.com/owa/calendar/x/y/calendar.ics',
    );
    expect(normalizeIcsUrl('https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc/basic.ics')).toContain('private-abc');
  });

  it.each([
    'http://example.com/cal.ics',
    'ftp://example.com/cal.ics',
    'not a url',
    'https://127.0.0.1/cal.ics',
    'https://2130706433/cal.ics',
    'https://[::1]/cal.ics',
    'https://10.1.2.3/cal.ics',
    'https://localhost/cal.ics',
    'https://printer.local/cal.ics',
    'https://metadata.google.internal/cal.ics',
    'https://intranet/cal.ics',
    'https://user:pw@example.com/cal.ics',
    'https://example.com:8443/cal.ics',
    `https://example.com/${'a'.repeat(2001)}`,
  ])('rejects %s', (u) => {
    expect(() => normalizeIcsUrl(u)).toThrow(IcsUrlError);
  });

  it('error messages never quote the link', () => {
    try {
      normalizeIcsUrl('http://example.com/SECRETPART.ics');
    } catch (e) {
      expect((e as Error).message).not.toContain('SECRETPART');
    }
  });
});

describe('isPrivateAddress', () => {
  it('flags private, loopback, link-local and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.20.1.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['17.253.144.10', '142.250.72.14', '2607:f8b0:4007:80f::200e']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe('fetchIcsText', () => {
  let prevFetch: typeof fetch;
  let prevResolver: ReturnType<typeof setIcsResolver>;
  let dns: Record<string, string[]> = {};
  let responses: Record<string, () => Response> = {};
  beforeAll(() => {
    prevResolver = setIcsResolver(async (h) => dns[h] ?? ['93.184.216.34']);
    prevFetch = setIcsFetch(async (input) => {
      const r = responses[String(input)];
      if (!r) throw new Error('unexpected fetch');
      return r();
    });
  });
  afterAll(() => {
    setIcsFetch(prevFetch);
    setIcsResolver(prevResolver);
  });

  it('refuses hosts that resolve to private addresses', async () => {
    dns = { 'evil.example.com': ['10.0.0.5'] };
    await expect(fetchIcsText('https://evil.example.com/a.ics')).rejects.toThrow(/private address/);
  });

  it('checks every redirect hop', async () => {
    dns = {};
    responses = { 'https://cal.example.com/a.ics': () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/x' } }) };
    await expect(fetchIcsText('https://cal.example.com/a.ics')).rejects.toThrow(IcsUrlError);
    responses = {
      'https://cal.example.com/a.ics': () => new Response(null, { status: 301, headers: { location: 'https://cdn.example.com/b.ics' } }),
      'https://cdn.example.com/b.ics': () => new Response('BEGIN:VCALENDAR\nEND:VCALENDAR'),
    };
    expect(await fetchIcsText('https://cal.example.com/a.ics')).toContain('VCALENDAR');
  });

  it('caps the size at 5 MB', async () => {
    responses = { 'https://big.example.com/a.ics': () => new Response('x', { headers: { 'content-length': String(6 * 1024 * 1024) } }) };
    await expect(fetchIcsText('https://big.example.com/a.ics')).rejects.toThrow(/5 MB/);
    const huge = 'x'.repeat(5 * 1024 * 1024 + 10);
    responses = { 'https://big.example.com/b.ics': () => new Response(huge) };
    await expect(fetchIcsText('https://big.example.com/b.ics')).rejects.toThrow(/5 MB/);
  });
});
