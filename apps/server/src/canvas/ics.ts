import { DateTime } from 'luxon';
import type { FeedEvent } from '@groupie/shared';
import { env } from '../env.ts';

/**
 * A small iCalendar reader for Canvas feeds: unfolds lines, reads VEVENTs, and turns
 * DTSTART/DTEND into UTC. Canvas feeds are simple, so no dependency is needed.
 */

type Prop = { value: string; params: Record<string, string> };
type RawEvent = Record<string, Prop>;

export class IcsError extends Error {}

const unescape = (s: string) => s.replace(/\\([\\;,nN])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

function parseLine(line: string): { name: string; prop: Prop } | null {
  // NAME;PARAM=a;PARAM2="b:c":value. The first colon outside quotes ends the name part.
  let inQuote = false;
  let idx = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    else if (line[i] === ':' && !inQuote) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return null;
  const [name, ...rawParams] = line.slice(0, idx).split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), prop: { value: line.slice(idx + 1), params } };
}

/** Reads every VEVENT. Throws IcsError when the text is not a calendar. */
export function readIcs(text: string): { tz: string | null; events: RawEvent[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  if (!lines.some((l) => l.trim().toUpperCase() === 'BEGIN:VCALENDAR')) throw new IcsError('Not a calendar file');
  let tz: string | null = null;
  const events: RawEvent[] = [];
  let current: RawEvent | null = null;
  let depth = 0; // nested components inside a VEVENT (VALARM)
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, prop } = parsed;
    if (name === 'BEGIN' && prop.value.toUpperCase() === 'VEVENT') {
      current = {};
      depth = 0;
    } else if (name === 'END' && prop.value.toUpperCase() === 'VEVENT') {
      if (current) events.push(current);
      current = null;
    } else if (current && name === 'BEGIN') depth++;
    else if (current && name === 'END') depth--;
    else if (current && depth === 0) current[name] = prop;
    else if (!current && name === 'X-WR-TIMEZONE') tz = prop.value.trim();
  }
  return { tz, events };
}

/** ICS date or date-time to a UTC ISO string, or null if unreadable. */
export function icsDateToIso(prop: Prop | undefined, calendarTz: string | null): string | null {
  if (!prop) return null;
  const v = prop.value.trim();
  const zone = prop.params.TZID ?? calendarTz ?? env.defaultTz;
  let dt: DateTime;
  if (/^\d{8}T\d{6}Z$/.test(v)) dt = DateTime.fromFormat(v, "yyyyMMdd'T'HHmmss'Z'", { zone: 'utc' });
  else if (/^\d{8}T\d{6}$/.test(v)) dt = DateTime.fromFormat(v, "yyyyMMdd'T'HHmmss", { zone });
  else if (/^\d{8}$/.test(v)) dt = DateTime.fromFormat(v, 'yyyyMMdd', { zone });
  else return null;
  return dt.isValid ? dt.toUTC().toISO({ suppressMilliseconds: false }) : null;
}

/** "Homework 5 [CSE 340 (Fall 2026)]" to title and course. */
export function splitSummary(summary: string): { title: string; course: string | null } {
  const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(summary.trim());
  if (!m || !m[1]) return { title: summary.trim(), course: null };
  return { title: m[1].trim(), course: m[2].trim() };
}

/** Parses a Canvas calendar feed into FeedEvents. Events without a UID or date are skipped. */
export function parseCanvasFeed(text: string): FeedEvent[] {
  const { tz, events } = readIcs(text);
  const out: FeedEvent[] = [];
  for (const e of events) {
    const uid = e.UID?.value.trim();
    const dueAt = icsDateToIso(e.DTSTART, tz) ?? icsDateToIso(e.DTEND, tz);
    if (!uid || !dueAt) continue;
    const { title, course } = splitSummary(unescape(e.SUMMARY?.value ?? ''));
    const description = e.DESCRIPTION ? unescape(e.DESCRIPTION.value).trim() || null : null;
    out.push({
      uid,
      course,
      title: title || 'Untitled',
      dueAt,
      description,
      url: e.URL?.value.trim() || null,
      kind: uid.startsWith('event-assignment-') ? 'assignment' : 'event',
    });
  }
  return out;
}
