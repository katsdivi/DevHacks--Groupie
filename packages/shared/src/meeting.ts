import { DateTime } from 'luxon';

export const MEETING_MODES = [
  { key: 'meet', label: 'Google Meet' },
  { key: 'zoom', label: 'Zoom' },
  { key: 'in_person', label: 'In person' },
] as const;
export type MeetingMode = (typeof MEETING_MODES)[number]['key'];

export const modeLabel = (mode: string | null | undefined) =>
  MEETING_MODES.find((m) => m.key === mode)?.label ?? 'Meeting';

export type MeetingInfo = {
  title: string;
  start: string; // UTC ISO
  end: string;
  details: string;
  /** A join URL, or a place for in-person meetings. */
  location: string | null;
};

const gcalStamp = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).toFormat("yyyyLLdd'T'HHmmss'Z'");

/** "Add to Google Calendar" link. Works for anyone without our Google keys. */
export function googleCalendarUrl(m: MeetingInfo): string {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: m.title,
    dates: `${gcalStamp(m.start)}/${gcalStamp(m.end)}`,
    details: m.details,
  });
  if (m.location) q.set('location', m.location);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** A standard .ics event any calendar app can import. */
export function icsFile(m: MeetingInfo & { uid: string }, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Groupie//Group project meeting//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${m.uid}`,
    `DTSTAMP:${gcalStamp(now.toISOString())}`,
    `DTSTART:${gcalStamp(m.start)}`,
    `DTEND:${gcalStamp(m.end)}`,
    `SUMMARY:${icsEscape(m.title)}`,
    `DESCRIPTION:${icsEscape(m.details)}`,
    ...(m.location ? [`LOCATION:${icsEscape(m.location)}`] : []),
    ...(m.location && /^https?:\/\//.test(m.location) ? [`URL:${m.location}`] : []),
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(m.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

/** Pulls the first http(s) link out of free text, if any. */
export function extractUrl(text: string): string | null {
  const m = /https?:\/\/[^\s<>"]+/i.exec(text);
  return m ? m[0].replace(/[).,!?]+$/, '') : null;
}

/** Cleans what someone typed as the meeting link or place. Null if unusable. */
export function parseMeetingLocation(raw: string, mode: string | null): string | null {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const url = extractUrl(text);
  if (mode === 'in_person') return text.length <= 120 ? text : null;
  return url;
}
