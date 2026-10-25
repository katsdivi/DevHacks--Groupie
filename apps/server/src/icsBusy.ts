import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { DateTime } from 'luxon';
import { env } from './env.ts';
import { icsDateToIso, readIcs } from './canvas/ics.ts';
import type { BusyInterval } from './busy.ts';

/**
 * ICS secret links (Apple iCloud, Outlook, Google secret iCal address) to busy blocks. Basic SSRF guard,
 * size and time limits, and a small RRULE expander (DAILY and WEEKLY). Never logs or returns the URL.
 */

export const ICS_MAX_URL = 2000;
export const ICS_MAX_BYTES = 5 * 1024 * 1024;
export const ICS_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const HOUR_MS = 3_600_000;

export class IcsUrlError extends Error {}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet', '.corp'];

/**
 * Normalizes a pasted link to https (webcal and webcals become https) or throws IcsUrlError with a short
 * message that never quotes the link. Rejects http, IP literals, local hostnames, credentials, odd ports.
 */
export function normalizeIcsUrl(raw: string): string {
  const s = raw.trim();
  if (!s || s.length > ICS_MAX_URL) throw new IcsUrlError('That link is too long or empty.');
  const rewritten = s.replace(/^webcals?:\/\//i, 'https://');
  let u: URL;
  try {
    u = new URL(rewritten);
  } catch {
    throw new IcsUrlError('That is not a link. Paste the full calendar address.');
  }
  if (u.protocol !== 'https:') throw new IcsUrlError('Use the https (or webcal) calendar link.');
  if (u.username || u.password) throw new IcsUrlError('Links with a username or password are not supported.');
  if (u.port && u.port !== '443') throw new IcsUrlError('That link uses an unusual port.');
  assertPublicHostname(u.hostname);
  u.hash = '';
  return u.toString();
}

function assertPublicHostname(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (isIP(host)) throw new IcsUrlError('Use the calendar link with a hostname, not an IP address.');
  if (!host.includes('.') || host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new IcsUrlError('That link points to a private address.');
  }
}

// Separate lists: Node matches IPv4 addresses against IPv4-mapped IPv6 rules too.
const PRIVATE_V4 = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) PRIVATE_V4.addSubnet(net, bits, 'ipv4');
const PRIVATE_V6 = new BlockList();
for (const [net, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['::ffff:0:0', 96], ['64:ff9b::', 96]] as const) {
  PRIVATE_V6.addSubnet(net, bits, 'ipv6');
}

/** True for loopback, private, link-local, CGNAT, multicast, and IPv4-mapped addresses. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return PRIVATE_V4.check(ip, 'ipv4');
  if (family === 6) return PRIVATE_V6.check(ip, 'ipv6');
  return true;
}

type Resolver = (host: string) => Promise<string[]>;
let resolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
type FetchFn = typeof fetch;
let fetchImpl: FetchFn = (...args) => fetch(...args);

/** Swaps DNS resolution (tests). Returns the previous one. */
export function setIcsResolver(r: Resolver): Resolver {
  const prev = resolver;
  resolver = r;
  return prev;
}
/** Swaps fetch (tests). Returns the previous one. */
export function setIcsFetch(f: FetchFn): FetchFn {
  const prev = fetchImpl;
  fetchImpl = f;
  return prev;
}

async function assertResolvesPublic(hostname: string) {
  let addrs: string[];
  try {
    addrs = await resolver(hostname);
  } catch {
    throw new IcsUrlError('Could not find that calendar host.');
  }
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new IcsUrlError('That link points to a private address.');
}

/** Reads the body up to ICS_MAX_BYTES, then gives up. */
async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > ICS_MAX_BYTES) throw new Error('The calendar is larger than 5 MB');
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > ICS_MAX_BYTES) {
      await reader.cancel();
      throw new Error('The calendar is larger than 5 MB');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Fetches the calendar text: public hosts only (checked on every redirect hop), timeout, 5 MB cap. */
export async function fetchIcsText(url: string): Promise<string> {
  let current = normalizeIcsUrl(url);
  const signal = AbortSignal.timeout(ICS_TIMEOUT_MS);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertResolvesPublic(new URL(current).hostname);
    const res = await fetchImpl(current, { headers: { accept: 'text/calendar, */*;q=0.5' }, redirect: 'manual', signal });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`The calendar host answered HTTP ${res.status}`);
      current = normalizeIcsUrl(new URL(loc, current).toString());
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      throw new Error(`The calendar link stopped working (HTTP ${res.status}). Copy a fresh link and paste it again.`);
    }
    if (!res.ok) throw new Error(`The calendar host answered HTTP ${res.status}`);
    return readCapped(res);
  }
  throw new Error('Too many redirects');
}

/** Common Windows zone names Outlook writes in TZID, mapped to IANA. */
const WINDOWS_TZ: Record<string, string> = {
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'GMT Standard Time': 'Europe/London',
  'India Standard Time': 'Asia/Kolkata',
  UTC: 'UTC',
};

type Prop = { value: string; params: Record<string, string> };
type RawEvent = Record<string, Prop>;

const validZone = (z: string | null | undefined) => (z && DateTime.local().setZone(z).isValid ? z : null);

function zoneFor(prop: Prop, calTz: string | null): string {
  const tzid = prop.params.TZID?.trim();
  return validZone(tzid) ?? validZone(tzid ? WINDOWS_TZ[tzid] : null) ?? validZone(calTz) ?? env.defaultTz;
}

/** DTSTART/DTEND to a zoned DateTime, or null. Unknown TZIDs fall back to the calendar zone. */
function toDateTime(prop: Prop | undefined, calTz: string | null): DateTime | null {
  if (!prop) return null;
  const zone = zoneFor(prop, calTz);
  const iso = icsDateToIso({ value: prop.value, params: { TZID: zone } }, calTz);
  return iso ? DateTime.fromISO(iso).setZone(zone) : null;
}

const isAllDay = (prop: Prop) => prop.params.VALUE?.toUpperCase() === 'DATE' || /^\d{8}$/.test(prop.value.trim());

/** ISO 8601 duration like PT1H30M or P1D, in ms; null if unreadable. */
function durationMs(v: string | undefined): number | null {
  const m = v && /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+(w ?? 0) * 7 + +(d ?? 0)) * 24 * 3600 + +(h ?? 0) * 3600 + +(mi ?? 0) * 60 + +(s ?? 0)) * 1000;
  return sign === '-' ? null : ms;
}

const DAYS: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

type Rule = { freq: string; interval: number; count: number | null; until: number | null; byDay: number[] };

function parseRule(v: string, calTz: string | null): Rule {
  const parts = Object.fromEntries(v.split(';').map((p) => p.split('=') as [string, string]).map(([k, x]) => [k.toUpperCase(), x ?? '']));
  const untilIso = parts.UNTIL ? icsDateToIso({ value: parts.UNTIL, params: {} }, calTz) : null;
  return {
    freq: (parts.FREQ ?? '').toUpperCase(),
    interval: Math.max(1, Number(parts.INTERVAL) || 1),
    count: parts.COUNT ? Number(parts.COUNT) || null : null,
    // A date-only UNTIL includes that whole day.
    until: untilIso ? new Date(untilIso).getTime() + (/^\d{8}$/.test(parts.UNTIL) ? 86_400_000 - 1 : 0) : null,
    byDay: (parts.BYDAY ?? '')
      .split(',')
      .map((d) => DAYS[d.trim().slice(-2).toUpperCase()])
      .filter((d): d is number => !!d),
  };
}

/**
 * Occurrence starts of a DAILY or WEEKLY rule in [fromMs - lookback, toMs], honoring COUNT and UNTIL.
 * Wall time is kept across DST. Without COUNT, it jumps straight to the window instead of walking years.
 */
function expand(start: DateTime, rule: Rule, fromMs: number, toMs: number): DateTime[] {
  const out: DateTime[] = [];
  const max = 20_000;
  let emitted = 0;
  const push = (dt: DateTime) => {
    if (rule.until !== null && dt.toMillis() > rule.until) return false;
    if (rule.count !== null && emitted >= rule.count) return false;
    if (dt.toMillis() > toMs) return false;
    emitted++;
    out.push(dt);
    return true;
  };
  const periodDays = (rule.freq === 'DAILY' ? 1 : 7) * rule.interval;
  // Start a couple of periods early so long events that began before the window still count.
  const skip = rule.count === null ? Math.max(0, Math.floor((fromMs - start.toMillis()) / (periodDays * 86_400_000)) - 2) : 0;
  if (rule.freq === 'DAILY') {
    for (let i = skip; i < skip + max; i++) if (!push(start.plus({ days: i * rule.interval }))) break;
  } else if (rule.freq === 'WEEKLY') {
    const days = rule.byDay.length ? [...new Set(rule.byDay)].sort() : [start.weekday];
    const weekStart = start.minus({ days: start.weekday - 1 });
    outer: for (let w = skip; w < skip + max; w++) {
      for (const d of days) {
        const dt = weekStart.plus({ weeks: w * rule.interval, days: d - 1 });
        if (dt.toMillis() < start.toMillis()) continue;
        if (!push(dt)) break outer;
      }
    }
  }
  return out;
}

export type IcsParseResult = { blocks: BusyInterval[]; unsupportedRules: number };

/**
 * Busy blocks overlapping [from, from + days). Skips TRANSP:TRANSPARENT, cancelled, and all-day events.
 * Expands DAILY and WEEKLY RRULEs (with EXDATE and RECURRENCE-ID overrides); other rules keep only the
 * first instance and are counted in `unsupportedRules`. A timed event with no end lasts one hour.
 */
export function icsToBusy(text: string, from: Date, days: number): IcsParseResult {
  const { tz, events } = readIcs(text);
  const calTz = validZone(tz);
  const fromMs = from.getTime();
  const toMs = fromMs + days * 86_400_000;
  const blocks: BusyInterval[] = [];
  let unsupportedRules = 0;

  // Instances replaced by a RECURRENCE-ID override: uid + start ms.
  const overridden = new Set<string>();
  for (const e of events) {
    const rid = toDateTime(e['RECURRENCE-ID'], calTz);
    if (rid && e.UID) overridden.add(`${e.UID.value.trim()}|${rid.toMillis()}`);
  }

  const add = (s: number, len: number) => {
    if (s < toMs && s + len > fromMs) blocks.push({ start: new Date(s).toISOString(), end: new Date(s + len).toISOString() });
  };

  for (const e of events as RawEvent[]) {
    if (!e.DTSTART || isAllDay(e.DTSTART)) continue;
    if (e.TRANSP?.value.trim().toUpperCase() === 'TRANSPARENT') continue;
    if (e.STATUS?.value.trim().toUpperCase() === 'CANCELLED') continue;
    const start = toDateTime(e.DTSTART, calTz);
    if (!start) continue;
    const end = e.DTEND && !isAllDay(e.DTEND) ? toDateTime(e.DTEND, calTz) : null;
    const len = end ? end.toMillis() - start.toMillis() : (durationMs(e.DURATION?.value) ?? HOUR_MS);
    if (!(len > 0)) continue;
    const uid = e.UID?.value.trim() ?? '';

    if (!e.RRULE || e['RECURRENCE-ID']) {
      add(start.toMillis(), len);
      continue;
    }
    const rule = parseRule(e.RRULE.value, calTz);
    if (rule.freq !== 'DAILY' && rule.freq !== 'WEEKLY') {
      unsupportedRules++;
      add(start.toMillis(), len);
      continue;
    }
    const exdates = new Set<number>();
    for (const [name, prop] of Object.entries(e)) {
      if (!name.startsWith('EXDATE')) continue;
      for (const v of prop.value.split(',')) {
        const dt = toDateTime({ value: v.trim(), params: prop.params }, calTz);
        if (dt) exdates.add(dt.toMillis());
      }
    }
    for (const occ of expand(start, rule, fromMs, toMs)) {
      const ms = occ.toMillis();
      if (exdates.has(ms) || overridden.has(`${uid}|${ms}`)) continue;
      add(ms, len);
    }
  }
  return { blocks, unsupportedRules };
}
